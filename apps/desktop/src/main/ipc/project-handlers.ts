import { dialog, ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  ImportProjectInputSchema,
  BatchImportInputSchema,
} from '@codehelm/contracts';
import {
  AnalysisRepository,
  ProfileRepository,
  ProjectRepository,
} from '@codehelm/database';
import { AnalyzerEngine, WorkspaceScanner } from '@codehelm/analyzer';
import { normalizePath } from '@codehelm/shared';
import fs from 'node:fs';
import path from 'node:path';
import { upsertAutoDetectedProfile } from './auto-profile.js';
import { getPersistentPortAllocator } from './persistent-port-allocator.js';

export function registerProjectHandlers(db: DatabaseInstance) {
  const projectRepo = new ProjectRepository(db);
  const analysisRepo = new AnalysisRepository(db);
  const profileRepo = new ProfileRepository(db);
  const workspaceScanner = new WorkspaceScanner();
  const analyzerEngine = new AnalyzerEngine();
  const portAllocator = getPersistentPortAllocator(db);

  // Helper to run quick analysis and auto-generate default RunProfile
  async function autoAnalyzeAndProfile(projectId: string, rootPath: string) {
    try {
      const existingProfiles = profileRepo.findByProjectId(projectId);
      if (existingProfiles.length > 0) return;

      const snapshot = await analyzerEngine.analyze(rootPath);
      snapshot.projectId = projectId;
      analysisRepo.save(snapshot);

      db.prepare('UPDATE projects SET last_analyzed_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        projectId
      );

      await upsertAutoDetectedProfile(profileRepo, projectId, snapshot, portAllocator);
    } catch (err) {
      console.warn(`Auto analyze failed for project ${projectId}:`, err);
    }
  }

  ipcMain.handle(IpcChannels.PROJECTS_SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择项目或工作区根目录',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const dirPath = normalizePath(result.filePaths[0]);
    const dirName = path.basename(dirPath);
    return {
      path: dirPath,
      name: dirName,
    };
  });

  // Scan workspace parent directory for batch discovery
  ipcMain.handle(
    IpcChannels.PROJECTS_SCAN_WORKSPACE,
    async (_event, rootPath: string, options?: { maxDepth?: number }) => {
      const normalizedRoot = normalizePath(rootPath);
      if (!fs.existsSync(normalizedRoot)) {
        throw new Error(`目录不存在: ${normalizedRoot}`);
      }
      return workspaceScanner.scan(normalizedRoot, options);
    }
  );

  ipcMain.handle(IpcChannels.PROJECTS_IMPORT, async (_event, rawInput) => {
    const input = ImportProjectInputSchema.parse(rawInput);
    const normalizedRoot = normalizePath(input.rootPath);

    if (!fs.existsSync(normalizedRoot)) {
      throw new Error(`目录不存在: ${normalizedRoot}`);
    }

    const stat = fs.statSync(normalizedRoot);
    if (!stat.isDirectory()) {
      throw new Error(`指定路径不是目录: ${normalizedRoot}`);
    }

    const existing = projectRepo.findByRootPath(normalizedRoot);
    if (existing) {
      return existing;
    }

    const projectName = input.name || path.basename(normalizedRoot);
    const project = projectRepo.create({
      name: projectName,
      rootPath: normalizedRoot,
      tags: input.tags,
      color: input.color,
      icon: input.icon,
    });

    // Wait for analysis so the detail page receives a usable profile immediately.
    await autoAnalyzeAndProfile(project.id, normalizedRoot);

    return project;
  });

  // Batch import multiple projects
  ipcMain.handle(IpcChannels.PROJECTS_BATCH_IMPORT, async (_event, rawInput) => {
    const parsed = BatchImportInputSchema.parse(rawInput);
    const results = [];

    for (const item of parsed.projects) {
      const normalizedRoot = normalizePath(item.rootPath);
      if (!fs.existsSync(normalizedRoot)) continue;

      let project = projectRepo.findByRootPath(normalizedRoot);
      if (!project) {
        const projectName = item.name || path.basename(normalizedRoot);
        project = projectRepo.create({
          name: projectName,
          rootPath: normalizedRoot,
          tags: item.tags,
          color: item.color,
          icon: item.icon,
        });
      }

      // Keep batch results deterministic: each returned project has completed its initial analysis.
      await autoAnalyzeAndProfile(project.id, normalizedRoot);
      results.push(project);
    }

    return results;
  });

  ipcMain.handle(IpcChannels.PROJECTS_LIST, async () => {
    return projectRepo.list();
  });

  ipcMain.handle(IpcChannels.PROJECTS_GET, async (_event, id: string) => {
    return projectRepo.findById(id);
  });

  ipcMain.handle(IpcChannels.PROJECTS_REMOVE, async (_event, id: string) => {
    projectRepo.delete(id);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.PROJECTS_UPDATE, async (_event, id: string, patch: any) => {
    const project = projectRepo.findById(id);
    if (!project) return null;
    if (patch.name) project.name = patch.name;
    if (patch.rootPath) project.rootPath = normalizePath(patch.rootPath);
    if (patch.tags) project.tags = patch.tags;

    db.prepare('UPDATE projects SET name = ?, root_path = ?, tags = ?, updated_at = ? WHERE id = ?').run(
      project.name,
      project.rootPath,
      JSON.stringify(project.tags),
      new Date().toISOString(),
      id
    );

    return projectRepo.findById(id);
  });

  const IGNORED_TREE_DIRS = new Set([
    '.git',
    'node_modules',
    '.venv',
    'venv',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'target',
    '__pycache__',
    '.idea',
    '.vscode',
  ]);

  async function buildFileTree(currentDir: string, rootDir: string, currentDepth: number, maxDepth: number): Promise<any[]> {
    if (currentDepth > maxDepth) return [];
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      const nodes: any[] = [];

      entries.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory() ? -1 : 1;
      });

      for (const entry of entries) {
        if (IGNORED_TREE_DIRS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        const normFull = normalizePath(fullPath);
        const relPath = normalizePath(path.relative(rootDir, fullPath));

        if (entry.isDirectory()) {
          const children = await buildFileTree(fullPath, rootDir, currentDepth + 1, maxDepth);
          nodes.push({
            name: entry.name,
            path: normFull,
            relativePath: relPath,
            type: 'directory',
            children,
          });
        } else if (entry.isFile()) {
          let size = 0;
          try {
            const stat = await fs.promises.stat(fullPath);
            size = stat.size;
          } catch {}

          const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '');
          nodes.push({
            name: entry.name,
            path: normFull,
            relativePath: relPath,
            type: 'file',
            size,
            extension: ext,
          });
        }
      }

      return nodes;
    } catch {
      return [];
    }
  }

  ipcMain.handle(IpcChannels.PROJECTS_GET_FILE_TREE, async (_event, rootPath: string, options?: { maxDepth?: number }) => {
    const normRoot = normalizePath(rootPath);
    if (!fs.existsSync(normRoot)) return [];
    const maxDepth = options?.maxDepth ?? 5;
    return buildFileTree(normRoot, normRoot, 1, maxDepth);
  });

  ipcMain.handle(IpcChannels.PROJECTS_GET_README, async (_event, rootPath: string) => {
    const normRoot = normalizePath(rootPath);
    if (!fs.existsSync(normRoot)) {
      return {
        hasReadme: false,
        title: '未检测到项目',
        description: '指定目录不存在',
        features: [],
      };
    }

    const candidateNames = [
      'README.md',
      'readme.md',
      'README.zh-CN.md',
      'README.zh.md',
      'README.MD',
      'Readme.md',
      'README.txt',
      'README',
    ];

    let readmePath: string | null = null;
    for (const name of candidateNames) {
      const full = path.join(normRoot, name);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        readmePath = full;
        break;
      }
    }

    if (!readmePath) {
      try {
        const files = fs.readdirSync(normRoot);
        const matched = files.find((f) => /^readme(\.[a-z0-9_-]+)?$/i.test(f));
        if (matched) {
          readmePath = path.join(normRoot, matched);
        }
      } catch {}
    }

    if (!readmePath) {
      const dirName = path.basename(normRoot);
      return {
        hasReadme: false,
        title: dirName,
        description: '该工程根目录下未包含 README.md 文档，可通过服务控制面板配置并运行各项服务。',
        features: [],
      };
    }

    try {
      const rawContent = fs.readFileSync(readmePath, 'utf-8');
      const lines = rawContent.split(/\r?\n/);

      let title = '';
      let description = '';
      const features: string[] = [];

      let inFeatureSection = false;
      const descLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('[![') || line.startsWith('<p align') || line.startsWith('<div align') || line.includes('shields.io')) {
          continue;
        }

        if (!title && (line.startsWith('# ') || /^<h1[^>]*>/.test(line))) {
          title = line.replace(/^#\s*/, '').replace(/<[^>]*>/g, '').trim();
          continue;
        }

        if (/^#{2,4}\s+/.test(line)) {
          const headingText = line.replace(/^#{2,4}\s+/, '').toLowerCase();
          if (
            headingText.includes('功能') ||
            headingText.includes('feature') ||
            headingText.includes('亮点') ||
            headingText.includes('特性') ||
            headingText.includes('highlight') ||
            headingText.includes('capabilities') ||
            headingText.includes('core')
          ) {
            inFeatureSection = true;
            continue;
          } else {
            if (inFeatureSection && features.length > 0) {
              inFeatureSection = false;
            }
          }
        }

        if (inFeatureSection) {
          if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
            const itemText = line
              .replace(/^[-*+]\s+/, '')
              .replace(/^\d+\.\s+/, '')
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1')
              .replace(/<[^>]*>/g, '')
              .trim();
            if (itemText && itemText.length > 2 && features.length < 8) {
              features.push(itemText);
            }
          }
        } else if (!description && descLines.length < 3 && !line.startsWith('#') && !line.startsWith('```')) {
          const cleanLine = line.replace(/<[^>]*>/g, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
          if (cleanLine && !cleanLine.startsWith('![')) {
            descLines.push(cleanLine);
          }
        }
      }

      if (descLines.length > 0) {
        description = descLines.join(' ');
      }

      if (features.length === 0) {
        for (const line of lines) {
          const trimmed = line.trim();
          if ((trimmed.startsWith('- ') || trimmed.startsWith('* ')) && !trimmed.includes('shields.io')) {
            const item = trimmed
              .replace(/^[-*]\s+/, '')
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1')
              .replace(/<[^>]*>/g, '')
              .trim();
            if (item.length > 4 && features.length < 6) {
              features.push(item);
            }
          }
        }
      }

      const fallbackTitle = path.basename(normRoot);

      return {
        hasReadme: true,
        title: title || fallbackTitle,
        description: description || '已自动解析本地工程 README 文档。',
        features,
      };
    } catch (err: any) {
      return {
        hasReadme: false,
        title: path.basename(normRoot),
        description: `读取 README 失败: ${err.message}`,
        features: [],
      };
    }
  });
}
