import fg from 'fast-glob';
import ignore from 'ignore';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePath } from '@codehelm/shared';
import type { DiscoveryContext } from '../types.js';

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

export interface DiscoveryOptions {
  maxFiles?: number;
  customIgnores?: string[];
  signal?: AbortSignal;
}

export class DiscoveryEngine {
  async discover(projectRoot: string, options: DiscoveryOptions = {}): Promise<DiscoveryContext> {
    const maxFiles = options.maxFiles ?? 50000;
    const normalizedRoot = normalizePath(projectRoot);

    // Setup gitignore matcher
    const ig = ignore();
    ig.add(DEFAULT_IGNORES);
    if (options.customIgnores) {
      ig.add(options.customIgnores);
    }

    const gitignorePath = path.join(normalizedRoot, '.gitignore');
    try {
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      ig.add(gitignoreContent);
    } catch {
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
