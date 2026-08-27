import fg from 'fast-glob';
import ignore from 'ignore';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePath, safeResolvePath } from '@codehelm/shared';
import type { DiscoveryContext } from '../types.js';
import {
  DEFAULT_MAX_ANALYZER_FILE_BYTES,
  readUtf8FileWithinLimit,
} from '../io/bounded-read.js';

export const DEFAULT_IGNORES = [
  '.git/**',
  '**/.git/**',
  'node_modules/**',
  '**/node_modules/**',
  '.venv/**',
  '**/.venv/**',
  'venv/**',
  '**/venv/**',
  '**/site-packages/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  'out/**',
  'target/**',
  '.next/**',
  '.nuxt/**',
  '.turbo/**',
  'coverage/**',
  '.cache/**',
  '.pytest_cache/**',
  '**/.pytest_cache/**',
  '__pycache__/**',
  '**/__pycache__/**',
  'bin/**',
  'obj/**',
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  '*.pyc',
  '*.class',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
];

export const MANIFEST_PATTERNS = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'uv.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'Cargo.lock',
  '*.csproj',
  '*.sln',
  'docker-compose.yml',
  'compose.yml',
];

export const CONFIG_PATTERNS = [
  'vite.config.*',
  'webpack.config.*',
  'tsconfig*.json',
  'next.config.*',
  'nuxt.config.*',
  'svelte.config.*',
  'astro.config.*',
  'angular.json',
  'vue.config.*',
  'tailwind.config.*',
  'uno.config.*',
  'eslint.config.*',
  '.eslintrc*',
  '.prettierrc*',
  'Dockerfile',
  'application.properties',
  'application.yml',
  'application.yaml',
  '.env.example',
  '.env.sample',
];

export const DEFAULT_MAX_DISCOVERY_FILES = 50_000;
export const MAX_DISCOVERY_FILES = 50_000;

export interface DiscoveryOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  customIgnores?: string[];
  signal?: AbortSignal;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function normalizeMaxFiles(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_DISCOVERY_FILES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid analyzer file count limit');
  }
  return Math.min(value, MAX_DISCOVERY_FILES);
}

export class DiscoveryEngine {
  async discover(projectRoot: string, options: DiscoveryOptions = {}): Promise<DiscoveryContext> {
    const maxFiles = normalizeMaxFiles(options.maxFiles);
    const normalizedRoot = normalizePath(projectRoot);

    // Setup gitignore matcher
    const ig = ignore();
    ig.add(DEFAULT_IGNORES);
    if (options.customIgnores) {
      ig.add(options.customIgnores);
    }

    const gitignorePath = path.join(normalizedRoot, '.gitignore');
    try {
      const gitignoreStat = await fs.lstat(gitignorePath);
      if (!gitignoreStat.isSymbolicLink() && gitignoreStat.isFile()) {
        const gitignoreContent = (await readUtf8FileWithinLimit(
          safeResolvePath(normalizedRoot, '.gitignore'),
          options.maxFileBytes ?? DEFAULT_MAX_ANALYZER_FILE_BYTES,
          options.signal
        )).text;
        ig.add(gitignoreContent);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
      // No .gitignore, continue
    }

    // Fast-glob all relative paths
    const stream = fg.stream(['**/*'], {
      cwd: normalizedRoot,
      dot: true,
      onlyFiles: true,
      ignore: DEFAULT_IGNORES,
      followSymbolicLinks: false,
    });

    const allFiles: string[] = [];
    const manifests: string[] = [];
    const configFiles: string[] = [];

    for await (const entry of stream) {
      if (options.signal?.aborted) {
        throw new Error('Analysis cancelled');
      }

      const fullPath = path.resolve(normalizedRoot, String(entry));
      let relPath = path.relative(normalizedRoot, fullPath).replace(/\\/g, '/');
      if (relPath.startsWith('./')) {
        relPath = relPath.slice(2);
      }

      if (relPath && ig.ignores(relPath)) {
        continue;
      }

      // fast-glob does not follow directory links, but file links can still
      // be returned by a provider. Never expose a linked file to detectors,
      // because later reads would otherwise follow it outside the workspace.
      let entryStat;
      try {
        entryStat = await fs.lstat(safeResolvePath(normalizedRoot, relPath));
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink() || !entryStat.isFile()) continue;

      allFiles.push(relPath);

      const fileName = path.basename(relPath);
      if (this.matchesPattern(fileName, MANIFEST_PATTERNS)) {
        manifests.push(relPath);
      }
      if (this.matchesPattern(fileName, CONFIG_PATTERNS)) {
        configFiles.push(relPath);
      }

      if (allFiles.length >= maxFiles) {
        break;
      }
    }

    return {
      projectRoot: normalizedRoot,
      files: allFiles,
      manifests,
      configFiles,
    };
  }

  private matchesPattern(fileName: string, patterns: string[]): boolean {
    return patterns.some((p) => {
      if (p.includes('*')) {
        const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return regex.test(fileName);
      }
      return fileName.toLowerCase() === p.toLowerCase();
    });
  }
}
