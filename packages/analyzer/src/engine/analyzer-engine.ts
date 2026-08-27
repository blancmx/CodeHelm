import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalysisSnapshot,
  DetectedTechnology,
  ModuleType,
  SuggestedCommand,
} from '@codehelm/domain';
import { generateId, normalizePath, safeResolvePath } from '@codehelm/shared';
import {
  DiscoveryEngine,
  MAX_DISCOVERY_FILES,
} from '../discovery/discovery-engine.js';
import { calculateLanguageStats } from '../languages/language-stats.js';
import { discoverModules } from '../modules/module-detector.js';
import { NodeDetector } from '../detectors/node-detector.js';
import { PythonDetector } from '../detectors/python-detector.js';
import { JavaDetector } from '../detectors/java-detector.js';
import { GoDetector } from '../detectors/go-detector.js';
import { RustDetector } from '../detectors/rust-detector.js';
import { DatabaseDetector } from '../detectors/database-detector.js';
import { parseJson } from '../parsers/index.js';
import type { AnalysisContext, Detector, ProjectAnalyzer } from '../types.js';
import {
  DEFAULT_MAX_ANALYZER_FILE_BYTES,
  DEFAULT_MAX_ANALYZER_TOTAL_READ_BYTES,
  ReadBudget,
  readUtf8FileWithinLimit,
} from '../io/bounded-read.js';

function isInsideModule(filePath: string, modulePath: string): boolean {
  return modulePath === '.' || filePath === modulePath || filePath.startsWith(`${modulePath}/`);
}

function ownerModule(filePath: string, modulePaths: string[]): string {
  return modulePaths
    .filter((modulePath) => isInsideModule(filePath, modulePath))
    .sort((a, b) => b.length - a.length)[0] ?? '.';
}

function dedupeTechnologies(items: DetectedTechnology[]): DetectedTechnology[] {
  const merged = new Map<string, DetectedTechnology>();
  for (const item of items) {
    const key = `${item.category}:${item.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, evidence: [...item.evidence] });
      continue;
    }
    existing.confidence = Math.max(existing.confidence, item.confidence);
    existing.versionRange ||= item.versionRange;
    for (const evidence of item.evidence) {
      if (!existing.evidence.some((entry) => entry.filePath === evidence.filePath && entry.detail === evidence.detail)) {
        existing.evidence.push(evidence);
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function dedupeCommands(items: SuggestedCommand[]): SuggestedCommand[] {
  const unique = new Map<string, SuggestedCommand>();
  for (const item of items) {
    const key = `${item.executable}\u0000${item.args.join('\u0000')}`;
    const existing = unique.get(key);
    if (!existing || item.confidence > existing.confidence) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => b.confidence - a.confidence);
}

function classifyModule(technologies: DetectedTechnology[], fallback: ModuleType): ModuleType {
  const hasFrontend = technologies.some((item) => item.category === 'frontend_framework');
  const hasBackend = technologies.some((item) => item.category === 'backend_framework');
  if (hasFrontend && hasBackend) return 'fullstack';
  if (hasFrontend) return 'frontend';
  if (hasBackend) return 'backend';
  return fallback;
}

function validateOptionalLimit(
  name: string,
  value: number | undefined,
  maximum?: number
): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`Invalid analyzer ${name}`);
  }
  return value === undefined || maximum === undefined ? value : Math.min(value, maximum);
}

function throwIfAnalysisCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Analysis cancelled');
}

function isAnalysisCancelled(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.message === 'Analysis cancelled');
}

function readCacheKey(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export interface AnalyzerEngineOptions {
  detectors?: Detector[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalReadBytes?: number;
}

export class AnalyzerEngine implements ProjectAnalyzer {
  private detectors: Detector[];
  private discoveryEngine: DiscoveryEngine;
  private options: AnalyzerEngineOptions;
  private abortController: AbortController | null = null;

  constructor(options: AnalyzerEngineOptions = {}) {
    this.options = {
      ...options,
      maxFiles: validateOptionalLimit('file count limit', options.maxFiles, MAX_DISCOVERY_FILES),
      maxFileBytes: validateOptionalLimit('file byte limit', options.maxFileBytes),
      maxTotalReadBytes: validateOptionalLimit('total read byte limit', options.maxTotalReadBytes),
    };
    this.detectors = options.detectors ?? [
      new NodeDetector(),
      new PythonDetector(),
      new JavaDetector(),
      new GoDetector(),
      new RustDetector(),
      new DatabaseDetector(),
    ];
    this.discoveryEngine = new DiscoveryEngine();
  }

  cancel(): void {
    this.abortController?.abort();
  }

  async analyze(
    projectRoot: string,
    onProgress?: (percent: number, file: string) => void
  ): Promise<AnalysisSnapshot> {
    const controller = new AbortController();
    this.abortController = controller;
    const startTime = new Date().toISOString();
    const snapshotId = generateId();
    const normalizedRoot = normalizePath(projectRoot);

    try {
      onProgress?.(10, '正在发现项目文件与忽略规则...');

      // 1. Discovery
      const discoveryContext = await this.discoveryEngine.discover(normalizedRoot, {
        maxFiles: this.options.maxFiles,
        maxFileBytes: this.options.maxFileBytes,
        signal: controller.signal,
      });
      throwIfAnalysisCancelled(controller.signal);

      onProgress?.(30, '正在统计编程语言体量...');

      // 2. Language Stats
      const langStats = calculateLanguageStats(discoveryContext.files);
      throwIfAnalysisCancelled(controller.signal);

      onProgress?.(50, '正在识别子模块与工作空间...');

      // 3. Module Detection
      const modules = discoverModules(discoveryContext);

      onProgress?.(70, '正在执行技术栈探测器...');

      // 4. Create Analysis Context
      const readBudget = new ReadBudget(
        this.options.maxTotalReadBytes ?? DEFAULT_MAX_ANALYZER_TOTAL_READ_BYTES
      );
      const readCache = new Map<string, Promise<string>>();
      const readFile = async (relPath: string): Promise<string> => {
        const cacheKey = readCacheKey(relPath);
        const cached = readCache.get(cacheKey);
        if (cached) return cached;

        const readPromise = (async () => {
          throwIfAnalysisCancelled(controller.signal);
          const reservedBytes = readBudget.reserve(
            this.options.maxFileBytes ?? DEFAULT_MAX_ANALYZER_FILE_BYTES
          );
          try {
            const result = await readUtf8FileWithinLimit(
              safeResolvePath(normalizedRoot, relPath),
              reservedBytes,
              controller.signal
            );
            readBudget.commit(reservedBytes, result.bytesRead);
            return result.text;
          } catch (error) {
            readBudget.release(reservedBytes);
            throw error;
          }
        })();
        readCache.set(cacheKey, readPromise);
        try {
          return await readPromise;
        } catch (error) {
          readCache.delete(cacheKey);
          throw error;
        }
      };

      const analysisContext: AnalysisContext = {
        ...discoveryContext,
        readFile,
        async readJson<T = unknown>(relPath: string): Promise<T | null> {
          try {
            const content = await this.readFile(relPath);
            return parseJson<T>(content);
          } catch (error) {
            if (isAnalysisCancelled(error, controller.signal)) throw error;
            return null;
          }
        },
        async fileExists(relPath: string): Promise<boolean> {
          try {
            const abs = safeResolvePath(normalizedRoot, relPath);
            await fs.access(abs);
            return true;
          } catch {
            return false;
          }
        },
      };

      // 5. Run detectors independently per module. A file belongs to its deepest module,
      // preventing a monorepo root from inheriting every child framework and command.
      const modulePaths = modules.map((module) => module.relativePath);
      for (const mod of modules) {
        throwIfAnalysisCancelled(controller.signal);
        mod.snapshotId = snapshotId;
        const owns = (filePath: string) => ownerModule(filePath, modulePaths) === mod.relativePath;
        const scopedContext: AnalysisContext = {
          ...analysisContext,
          moduleRelativePath: mod.relativePath,
          files: discoveryContext.files.filter(owns),
          manifests: discoveryContext.manifests.filter(owns),
          configFiles: discoveryContext.configFiles.filter(owns),
        };
        const detected: DetectedTechnology[] = [];
        const commands: SuggestedCommand[] = [];

        for (const detector of this.detectors) {
          throwIfAnalysisCancelled(controller.signal);
          if (!detector.supports(scopedContext)) continue;
          try {
            const results = await detector.detect(scopedContext);
            throwIfAnalysisCancelled(controller.signal);
            for (const result of results) {
              detected.push(result.technology);
              if (result.suggestedCommands) commands.push(...result.suggestedCommands);
            }
          } catch (err) {
            if (isAnalysisCancelled(err, controller.signal)) throw err;
            console.warn(`Detector ${detector.id} warning in ${mod.relativePath}:`, err);
          }
        }

        mod.technologies = dedupeTechnologies(detected);
        mod.suggestedCommands = dedupeCommands(commands);
        mod.moduleType = classifyModule(mod.technologies, mod.moduleType);
      }

      throwIfAnalysisCancelled(controller.signal);
      onProgress?.(100, '分析完成');

      return {
        id: snapshotId,
        projectId: '',
        analyzerVersion: '1.1.0',
        status: 'completed',
        primaryLanguage: langStats.primaryLanguage,
        languages: langStats.languages,
        modules,
        startedAt: startTime,
        completedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (isAnalysisCancelled(err, controller.signal)) {
        return {
          id: snapshotId,
          projectId: '',
          analyzerVersion: '1.1.0',
          status: 'cancelled',
          primaryLanguage: 'Unknown',
          languages: [],
          modules: [],
          startedAt: startTime,
          completedAt: new Date().toISOString(),
          errorMessage: '用户手动取消分析',
        };
      }

      return {
        id: snapshotId,
        projectId: '',
        analyzerVersion: '1.1.0',
        status: 'failed',
        primaryLanguage: 'Unknown',
        languages: [],
        modules: [],
        startedAt: startTime,
        completedAt: new Date().toISOString(),
          errorMessage: err.message || '分析失败',
        };
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }
}
