import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import type { SuggestedCommand, TechnologyCategory } from '@codehelm/domain';
import path from 'node:path';

interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const PORT_TOKEN = '{{PORT}}';

function projectPath(...parts: string[]): string {
  const joined = path.posix.join(...parts.map((part) => part.replace(/\\/g, '/')));
  return joined === '.' ? '' : joined.replace(/^\.\//, '');
}

function ancestorDirs(startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir === '.' ? '' : startDir.replace(/\\/g, '/');
  while (true) {
    dirs.push(current);
    if (!current) break;
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
  return dirs;
}

function extractDeclaredPort(script: string): number | undefined {
  const patterns = [
    /(?:--port|-p)(?:=|\s+)(\d{2,5})\b/i,
    /(?:^|\s)(?:PORT|VITE_PORT|NUXT_PORT)\s*=\s*(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function extractPortFromSource(source: string): number | undefined {
  const patterns = [
    /(?:const|let|var)\s+PORT\s*=\s*[^\r\n;]*?(?:\|\||\?\?)\s*(\d{2,5})\b/i,
    /(?:const|let|var)\s+PORT\s*=\s*(\d{2,5})\b/i,
    /\.listen\(\s*(\d{2,5})\b/i,
    /^\s*(?:PORT|APP_PORT|SERVER_PORT)\s*=\s*(\d{2,5})\b/im,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function packageManagerDisplayName(manager: PackageManager): string {
  if (manager === 'yarn') return 'Yarn';
  if (manager === 'bun') return 'Bun';
  return manager;
}

export class NodeDetector implements Detector {
  readonly id = 'node-detector';
  readonly name = 'Node.js & JavaScript Ecosystem Detector';

  supports(context: DiscoveryContext): boolean {
    return context.manifests.some((manifest) => path.basename(manifest) === 'package.json');
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const packageFiles = context.manifests.filter((manifest) => path.basename(manifest) === 'package.json');

    for (const packagePath of packageFiles) {
      const pkg = await context.readJson<PackageJson>(packagePath);
      if (!pkg) continue;

      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      const moduleDir = path.posix.dirname(packagePath.replace(/\\/g, '/'));
      const manager = await this.detectPackageManager(context, moduleDir, pkg, results);

      this.addTechnology(results, 'Node.js', 'runtime', packagePath, 'package.json defines a Node.js project', undefined, 0.98);

      if (dependencies['typescript'] || context.configFiles.some((file) => path.basename(file).startsWith('tsconfig'))) {
        this.addTechnology(results, 'TypeScript', 'language', packagePath, 'TypeScript dependency or tsconfig detected', dependencies['typescript']);
      }

      const frameworkChecks: Array<[string, string, TechnologyCategory, string]> = [
        ['vue', this.vueName(dependencies['vue']), 'frontend_framework', 'vue'],
        ['react', 'React', 'frontend_framework', 'react'],
        ['next', 'Next.js', 'frontend_framework', 'next'],
        ['nuxt', 'Nuxt', 'frontend_framework', 'nuxt'],
        ['nuxt3', 'Nuxt', 'frontend_framework', 'nuxt3'],
        ['svelte', 'Svelte', 'frontend_framework', 'svelte'],
        ['@angular/core', 'Angular', 'frontend_framework', '@angular/core'],
        ['astro', 'Astro', 'frontend_framework', 'astro'],
        ['@remix-run/react', 'Remix', 'frontend_framework', '@remix-run/react'],
        ['@nestjs/core', 'NestJS', 'backend_framework', '@nestjs/core'],
        ['express', 'Express', 'backend_framework', 'express'],
        ['fastify', 'Fastify', 'backend_framework', 'fastify'],
        ['koa', 'Koa', 'backend_framework', 'koa'],
        ['hono', 'Hono', 'backend_framework', 'hono'],
        ['vite', 'Vite', 'build_tool', 'vite'],
        ['webpack', 'Webpack', 'build_tool', 'webpack'],
        ['@rspack/core', 'Rspack', 'build_tool', '@rspack/core'],
        ['electron', 'Electron', 'runtime', 'electron'],
        ['@tauri-apps/api', 'Tauri', 'runtime', '@tauri-apps/api'],
        ['vitest', 'Vitest', 'testing', 'vitest'],
        ['jest', 'Jest', 'testing', 'jest'],
        ['@playwright/test', 'Playwright', 'testing', '@playwright/test'],
        ['tailwindcss', 'Tailwind CSS', 'tooling', 'tailwindcss'],
        ['unocss', 'UnoCSS', 'tooling', 'unocss'],
      ];

      for (const [dependency, name, category, evidenceName] of frameworkChecks) {
        const version = dependencies[dependency];
        if (!version) continue;
        this.addTechnology(results, name, category, packagePath, `${evidenceName}: ${version}`, version);
      }

      const command = await this.inferCommand(context, pkg, packagePath, manager, dependencies);
      if (command && results.length > 0) results[0].suggestedCommands = [command];
    }

    return results;
  }

  private async detectPackageManager(
    context: AnalysisContext,
    moduleDir: string,
    pkg: PackageJson,
    results: DetectionResult[]
  ): Promise<PackageManager> {
    const declared = pkg.packageManager?.split('@')[0]?.toLowerCase();
    const declaredManager: PackageManager | undefined =
      declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm'
        ? declared
        : undefined;

    const lockfiles: Array<[PackageManager, string[]]> = [
      ['pnpm', ['pnpm-lock.yaml']],
      ['bun', ['bun.lock', 'bun.lockb']],
      ['yarn', ['yarn.lock']],
      ['npm', ['package-lock.json', 'npm-shrinkwrap.json']],
    ];

    let manager = declaredManager;
    let evidenceFile = packagePathForDir(moduleDir, 'package.json');
    let evidenceDetail = declaredManager ? `packageManager: ${pkg.packageManager}` : '';
    let hasExplicitEvidence = Boolean(declaredManager);

    if (!manager) {
      outer: for (const dir of ancestorDirs(moduleDir)) {
        for (const [candidateManager, names] of lockfiles) {
          for (const name of names) {
            const candidate = projectPath(dir, name);
            if (await context.fileExists(candidate)) {
              manager = candidateManager;
              evidenceFile = candidate;
              evidenceDetail = `${name} detected`;
              hasExplicitEvidence = true;
              break outer;
            }
          }
        }
      }
    }

    manager ??= 'npm';
    if (!evidenceDetail) evidenceDetail = 'No package manager declaration or lockfile; npm fallback';

    results.push({
      technology: {
        name: packageManagerDisplayName(manager),
        category: 'package_manager',
        confidence: hasExplicitEvidence ? 1 : 0.55,
        evidence: [{ type: 'manifest', filePath: evidenceFile || 'package.json', detail: evidenceDetail }],
        source: 'detected',
      },
    });
    return manager;
  }

  private async inferCommand(
    context: AnalysisContext,
    pkg: PackageJson,
    packagePath: string,
    manager: PackageManager,
    dependencies: Record<string, string>
  ): Promise<SuggestedCommand | undefined> {
    const scripts = pkg.scripts ?? {};
    const scriptName = ['dev', 'start', 'serve', 'preview'].find((name) => Boolean(scripts[name]));
    if (!scriptName) return undefined;

    const script = scripts[scriptName];
    const isFrontend = Boolean(
      dependencies['vite'] || dependencies['next'] || dependencies['nuxt'] || dependencies['nuxt3'] ||
      dependencies['astro'] || dependencies['@angular/core'] || dependencies['react-scripts']
    );
    const isBackend = Boolean(
      dependencies['express'] || dependencies['@nestjs/core'] || dependencies['fastify'] ||
      dependencies['koa'] || dependencies['hono']
    );

    let port = extractDeclaredPort(script);
    if (!port && isBackend) {
      port = await this.inferBackendSourcePort(context, script);
    }
    if (!port) {
      const viteConfig = context.configFiles.find((file) => /^vite\.config\./i.test(path.basename(file)));
      if (viteConfig) {
        try {
          const configText = await context.readFile(viteConfig);
          const configPort = configText.match(/\bport\s*:\s*(\d{2,5})\b/);
          if (configPort) port = Number(configPort[1]);
        } catch {
          // Keep framework default.
        }
      }
    }

    port ??= dependencies['vite'] ? 5173
      : dependencies['astro'] ? 4321
      : dependencies['@angular/core'] ? 4200
      : dependencies['next'] || dependencies['nuxt'] || dependencies['nuxt3'] ? 3000
      : isBackend ? 3000
      : undefined;

    const args = ['run', scriptName];
    if (port && isFrontend) {
      if (manager === 'npm' || manager === 'pnpm') args.push('--');
      args.push('--port', PORT_TOKEN);
      if (dependencies['vite'] && !/\b--strictPort\b/i.test(script)) args.push('--strictPort');
    }

    return {
      name: `${pkg.name || path.basename(context.moduleRelativePath || context.projectRoot)} (${scriptName})`,
      executable: manager,
      args,
      type: isFrontend ? 'frontend' : isBackend ? 'backend' : 'tool',
      confidence: 0.98,
      source: `${packagePath} -> scripts.${scriptName}: ${script}`,
      port,
    };
  }

  private async inferBackendSourcePort(
    context: AnalysisContext,
    script: string
  ): Promise<number | undefined> {
    const modulePrefix = context.moduleRelativePath && context.moduleRelativePath !== '.'
      ? `${context.moduleRelativePath.replace(/\\/g, '/')}/`
      : '';
    const sourceFiles = context.files
      .filter((file) => /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]+\.(?:[cm]?[jt]s))$/i.test(file))
      .sort((left, right) => {
        const leftLocal = left.slice(modulePrefix.length);
        const rightLocal = right.slice(modulePrefix.length);
        const leftScore = script.includes(leftLocal) ? 0 : /(?:server|main|index|app)\./i.test(leftLocal) ? 1 : 2;
        const rightScore = script.includes(rightLocal) ? 0 : /(?:server|main|index|app)\./i.test(rightLocal) ? 1 : 2;
        return leftScore - rightScore;
      });

    // Keep analysis bounded on very large Node repositories.
    for (const file of sourceFiles.slice(0, 80)) {
      try {
        const source = await context.readFile(file);
        const port = extractPortFromSource(source);
        if (port) return port;
      } catch {
        // Ignore unreadable source files and continue with framework defaults.
      }
    }
    return undefined;
  }

  private addTechnology(
    results: DetectionResult[],
    name: string,
    category: TechnologyCategory,
    filePath: string,
    detail: string,
    versionRange?: string,
    confidence = 1
  ): void {
    results.push({
      technology: {
        name,
        category,
        versionRange,
        confidence,
        evidence: [{ type: 'manifest', filePath, detail }],
        source: 'detected',
      },
    });
  }

  private vueName(version?: string): string {
    const major = version?.match(/\d+/)?.[0];
    return major === '3' ? 'Vue 3' : major === '2' ? 'Vue 2' : 'Vue.js';
  }
}

function packagePathForDir(dir: string, fileName: string): string {
  return projectPath(dir, fileName) || fileName;
}
