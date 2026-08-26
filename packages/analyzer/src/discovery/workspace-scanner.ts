import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { DiscoveredProjectDto } from '@codehelm/contracts';
import { generateId, normalizePath } from '@codehelm/shared';
import { parseJson } from '../parsers/index.js';

export interface WorkspaceScannerOptions {
  maxDepth?: number;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.next',
  '.nuxt',
  '.output',
  'out',
  '.cache',
  'temp',
  'tmp',
]);

function parsePort(text: string): number | undefined {
  const patterns = [
    /(?:--port|-p)\s*[= ]\s*(\d{2,5})/i,
    /(?:PORT|server\.port)\s*[=:]\s*(\d{2,5})/i,
    /\b(?:listen|run)\s*\(\s*(\d{2,5})/i,
    /\bport\s*=\s*(\d{2,5})/i,
  ];
  for (const pattern of patterns) {
    const value = Number(text.match(pattern)?.[1]);
    if (value >= 1 && value <= 65535) return value;
  }
  return undefined;
}

function pythonModuleName(relativeFile: string): string {
  return relativeFile.replace(/\.py$/i, '').replace(/[\\/]/g, '.');
}

export class WorkspaceScanner {
  async scan(rootPath: string, options: WorkspaceScannerOptions = {}): Promise<DiscoveredProjectDto[]> {
    const normalizedRoot = normalizePath(rootPath);
    const maxDepth = options.maxDepth ?? 2;
    const results: DiscoveredProjectDto[] = [];
    const scannedPaths = new Set<string>();

    // 1. Check if the root directory itself is a project
    const rootProject = await this.inspectDirectory(normalizedRoot, normalizedRoot);
    if (rootProject) {
      results.push(rootProject);
      scannedPaths.add(normalizedRoot);
    }

    // 2. Scan subdirectories up to maxDepth
    await this.scanRecursive(normalizedRoot, normalizedRoot, 1, maxDepth, results, scannedPaths);

    return results;
  }

  private async scanRecursive(
    currentDir: string,
    workspaceRoot: string,
    currentDepth: number,
    maxDepth: number,
    results: DiscoveredProjectDto[],
    scannedPaths: Set<string>
  ): Promise<void> {
    if (currentDepth > maxDepth) return;

    let entries: string[];
    try {
      entries = await fs.readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;

      const subPath = path.join(currentDir, entry);
      let stat;
      try {
        stat = await fs.stat(subPath);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) continue;

      // Inspect if subPath is a project
      const normalizedSub = normalizePath(subPath);
      if (!scannedPaths.has(normalizedSub)) {
        const project = await this.inspectDirectory(normalizedSub, workspaceRoot);
        if (project) {
          results.push(project);
          scannedPaths.add(normalizedSub);
          // If this directory is already a detected project (like a next.js app or python app),
          // don't descend deeper into its source code unless it's a monorepo workspace (like packages/)
          if (entry !== 'packages' && entry !== 'apps' && entry !== 'modules') {
            continue;
          }
        }
      }

      // Descend into next level
      await this.scanRecursive(subPath, workspaceRoot, currentDepth + 1, maxDepth, results, scannedPaths);
    }
  }

  private async inspectDirectory(dirPath: string, workspaceRoot: string): Promise<DiscoveredProjectDto | null> {
    const dirName = path.basename(dirPath) || 'project';
    const relativePath = path.relative(workspaceRoot, dirPath) || '.';

    const hasPackageJson = fsSync.existsSync(path.join(dirPath, 'package.json'));
    const hasRequirementsTxt = fsSync.existsSync(path.join(dirPath, 'requirements.txt'));
    const hasPyproject = fsSync.existsSync(path.join(dirPath, 'pyproject.toml'));
    const hasPipfile = fsSync.existsSync(path.join(dirPath, 'Pipfile'));
    const hasMainPy = fsSync.existsSync(path.join(dirPath, 'main.py')) || fsSync.existsSync(path.join(dirPath, 'app.py'));
    const hasIndexHtml = fsSync.existsSync(path.join(dirPath, 'index.html'));
    const hasCargoToml = fsSync.existsSync(path.join(dirPath, 'Cargo.toml'));
    const hasGoMod = fsSync.existsSync(path.join(dirPath, 'go.mod'));
    const hasPomXml = fsSync.existsSync(path.join(dirPath, 'pom.xml'));
    const hasBuildGradle = fsSync.existsSync(path.join(dirPath, 'build.gradle'));

    const hasEnvExample =
      fsSync.existsSync(path.join(dirPath, '.env.example')) || fsSync.existsSync(path.join(dirPath, '.env.sample'));
    const hasEnv = fsSync.existsSync(path.join(dirPath, '.env'));

    // --- Case 1: Node.js / Web Project ---
    if (hasPackageJson) {
      let pkg: any = {};
      try {
        const pkgContent = await fs.readFile(path.join(dirPath, 'package.json'), 'utf-8');
        pkg = parseJson(pkgContent) || {};
      } catch {
        // ignore
      }

      const name = pkg.name || dirName;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const scripts = pkg.scripts || {};

      // Determine package manager
      let pm = typeof pkg.packageManager === 'string'
        ? pkg.packageManager.split('@')[0]
        : 'npm';
      let lockSearchPath = dirPath;
      while (lockSearchPath.startsWith(workspaceRoot)) {
        if (fsSync.existsSync(path.join(lockSearchPath, 'pnpm-lock.yaml'))) {
          pm = 'pnpm';
          break;
        }
        if (fsSync.existsSync(path.join(lockSearchPath, 'yarn.lock'))) {
          pm = 'yarn';
          break;
        }
        if (fsSync.existsSync(path.join(lockSearchPath, 'bun.lockb')) || fsSync.existsSync(path.join(lockSearchPath, 'bun.lock'))) {
          pm = 'bun';
          break;
        }
        if (lockSearchPath === workspaceRoot) break;
        const parent = path.dirname(lockSearchPath);
        if (parent === lockSearchPath) break;
        lockSearchPath = parent;
      }

      // Framework detection
      let framework = 'Node.js App';
      let port = 3000;
      const tags: string[] = ['Node.js'];

      if (deps['next']) {
        framework = 'Next.js';
        port = 3000;
        tags.push('Next.js', 'React');
      } else if (deps['nuxt'] || deps['nuxt3']) {
        framework = 'Nuxt';
        port = 3000;
        tags.push('Nuxt', 'Vue');
      } else if (deps['vite']) {
        if (deps['vue']) {
          framework = 'Vite (Vue 3)';
          tags.push('Vue 3', 'Vite');
        } else if (deps['react']) {
          framework = 'Vite (React)';
          tags.push('React', 'Vite');
        } else if (deps['svelte']) {
          framework = 'Vite (Svelte)';
          tags.push('Svelte', 'Vite');
        } else {
          framework = 'Vite App';
          tags.push('Vite');
        }
        port = 5173;
      } else if (deps['@remix-run/react']) {
        framework = 'Remix';
        tags.push('Remix', 'React');
      } else if (deps['astro']) {
        framework = 'Astro';
        port = 4321;
        tags.push('Astro');
      } else if (deps['express'] || deps['koa'] || deps['fastify'] || deps['@nestjs/core']) {
        framework = 'Node.js API Server';
        port = 8080;
        tags.push('Backend', 'API');
      }
      if (deps['typescript']) tags.push('TypeScript');
      if (deps['tailwindcss']) tags.push('Tailwind CSS');
      if (deps['electron']) tags.push('Electron');
      if (deps['@tauri-apps/api']) tags.push('Tauri');

      // Check if node_modules exists
      const hasNodeModules = fsSync.existsSync(path.join(dirPath, 'node_modules'));

      // Recommended run command
      let runCmd = `${pm} start`;
      if (scripts.dev) runCmd = `${pm} run dev`;
      else if (scripts.start) runCmd = `${pm} start`;
      else if (scripts.serve) runCmd = `${pm} run serve`;
      else if (scripts.preview) runCmd = `${pm} run preview`;

      const selectedScript = scripts.dev || scripts.start || scripts.serve || scripts.preview;
      port = parsePort(String(selectedScript || '')) ?? port;

      const installCmd = `${pm} install`;

      return {
        id: generateId(),
        name,
        rootPath: dirPath,
        relativePath,
        type: 'node',
        framework,
        hasDependenciesInstalled: hasNodeModules,
        missingDependencyType: hasNodeModules ? 'none' : 'node_modules',
        recommendedInstallCommand: installCmd,
        recommendedRunCommand: runCmd,
        tags,
        hasEnvExample,
        hasEnv,
        port,
      };
    }

    let pythonFiles: string[] = [];
    try {
      const collectPythonFiles = (currentPath: string, relativeBase: string, depth: number) => {
        if (depth > 2) return;
        for (const entry of fsSync.readdirSync(currentPath, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
          const relativeEntry = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
          if (entry.isFile() && entry.name.endsWith('.py')) pythonFiles.push(relativeEntry);
          else if (entry.isDirectory()) collectPythonFiles(path.join(currentPath, entry.name), relativeEntry, depth + 1);
        }
      };
      collectPythonFiles(dirPath, '', 0);
    } catch {}
    const hasAnyPy = pythonFiles.length > 0;

    // --- Case 2: Python Vibe / AI / Game / CLI Project ---
    if (hasRequirementsTxt || hasPyproject || hasPipfile || hasMainPy || hasAnyPy) {
      let framework = 'Python App';
      let port: number | undefined = undefined;
      const tags: string[] = ['Python'];

      let reqContent = '';
      if (hasRequirementsTxt) {
        try {
          reqContent = await fs.readFile(path.join(dirPath, 'requirements.txt'), 'utf-8');
        } catch {
          // ignore
        }
      }
      if (hasPyproject) {
        try {
          reqContent += '\n' + await fs.readFile(path.join(dirPath, 'pyproject.toml'), 'utf-8');
        } catch {}
      }
      if (hasPipfile) {
        try {
          reqContent += '\n' + await fs.readFile(path.join(dirPath, 'Pipfile'), 'utf-8');
        } catch {}
      }

      // If no requirements.txt or small, read top .py files content for import discovery
      let combinedPyCode = '';
      const pythonCode = new Map<string, string>();
      const prioritizedPythonFiles = [...pythonFiles].sort((a, b) => {
        const score = (file: string) => /(^|[\\/])(main|app|server|manage|streamlit_app)\.py$/i.test(file) ? 0 : 1;
        return score(a) - score(b) || a.localeCompare(b);
      });
      for (const pyF of prioritizedPythonFiles.slice(0, 20)) {
        try {
          const code = await fs.readFile(path.join(dirPath, pyF), 'utf-8');
          combinedPyCode += '\n' + code;
          pythonCode.set(pyF, code);
        } catch {}
      }

      const allPyText = (reqContent + '\n' + combinedPyCode).toLowerCase();

      const isStreamlit =
        allPyText.includes('streamlit') ||
        fsSync.existsSync(path.join(dirPath, 'streamlit_app.py')) ||
        fsSync.existsSync(path.join(dirPath, 'app_streamlit.py'));
      const isFastAPI = allPyText.includes('fastapi') || allPyText.includes('uvicorn');
      const isFlask = allPyText.includes('flask');
      const isGradio = allPyText.includes('gradio');
      const isDjango = fsSync.existsSync(path.join(dirPath, 'manage.py')) || allPyText.includes('django');
      const isPygame = allPyText.includes('pygame');
      const isTurtle = allPyText.includes('turtle');
      const isTkinter = allPyText.includes('tkinter');
      const isLangChain = allPyText.includes('langchain');

      // Pick main python entry file
      const primaryEntryPy =
        prioritizedPythonFiles.find((f) => /(^|[\\/])(main|app|snake|game|run|index|server)\.py$/i.test(f)) ||
        pythonFiles[0] ||
        'main.py';

      const appFactory = (constructorName: 'FastAPI' | 'Flask') => {
        for (const [file, code] of pythonCode) {
          const variable = code.match(new RegExp(`([A-Za-z_]\\w*)\\s*=\\s*${constructorName}\\s*\\(`))?.[1];
          if (variable) return `${pythonModuleName(file)}:${variable}`;
        }
        return undefined;
      };

      const detectedSourcePort = parsePort(combinedPyCode);
      const usesUv = fsSync.existsSync(path.join(dirPath, 'uv.lock')) || /\[tool\.uv\]/i.test(reqContent);
      const usesPoetry = fsSync.existsSync(path.join(dirPath, 'poetry.lock')) || /\[tool\.poetry\]/i.test(reqContent);
      const pythonPrefix = usesUv ? 'uv run ' : usesPoetry ? 'poetry run ' : '';

      let runCmd = `python ${primaryEntryPy}`;
      if (isStreamlit) {
        framework = 'Streamlit AI App';
        port = 8501;
        const targetFile = fsSync.existsSync(path.join(dirPath, 'streamlit_app.py'))
          ? 'streamlit_app.py'
          : fsSync.existsSync(path.join(dirPath, 'app.py'))
          ? 'app.py'
          : primaryEntryPy;
        runCmd = `${pythonPrefix}streamlit run ${targetFile} --server.port ${detectedSourcePort ?? port}`;
        tags.push('Streamlit', 'AI App');
      } else if (isFastAPI) {
        framework = isLangChain ? 'FastAPI + LangChain' : 'FastAPI Backend';
        port = detectedSourcePort ?? 8000;
        runCmd = `${pythonPrefix}uvicorn ${appFactory('FastAPI') ?? `${pythonModuleName(primaryEntryPy)}:app`} --reload --port ${port}`;
        tags.push('FastAPI', 'Backend');
        if (isLangChain) tags.push('LangChain', 'AI');
      } else if (isFlask) {
        framework = 'Flask App';
        port = detectedSourcePort ?? 5000;
        const flaskTarget = appFactory('Flask');
        runCmd = flaskTarget
          ? `${pythonPrefix}flask --app ${flaskTarget} run --port ${port}`
          : `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('Flask', 'Backend');
      } else if (isGradio) {
        framework = 'Gradio AI Interface';
        port = 7860;
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('Gradio', 'AI UI');
      } else if (isDjango) {
        framework = 'Django App';
        port = detectedSourcePort ?? 8000;
        runCmd = `${pythonPrefix}python manage.py runserver 127.0.0.1:${port}`;
        tags.push('Django');
      } else if (isPygame) {
        framework = 'Pygame (Python Game)';
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('Pygame', 'Game');
      } else if (isTurtle) {
        framework = 'Turtle Graphics';
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('Turtle', 'Graphics');
      } else if (isTkinter) {
        framework = 'Tkinter GUI';
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('Tkinter', 'GUI');
      } else if (isLangChain) {
        framework = 'LangChain AI Agent';
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
        tags.push('LangChain', 'AI');
      } else {
        framework = 'Python Application';
        runCmd = `${pythonPrefix}python ${primaryEntryPy}`;
      }

      const hasVenv =
        fsSync.existsSync(path.join(dirPath, '.venv')) ||
        fsSync.existsSync(path.join(dirPath, 'venv')) ||
        fsSync.existsSync(path.join(dirPath, 'env'));

      const installCmd = usesUv
        ? 'uv sync'
        : usesPoetry
          ? 'poetry install'
          : hasPipfile
            ? 'pipenv install'
            : hasRequirementsTxt
              ? 'pip install -r requirements.txt'
              : undefined;

      return {
        id: generateId(),
        name: dirName,
        rootPath: dirPath,
        relativePath,
        type: 'python',
        framework,
        hasDependenciesInstalled: hasVenv || !hasRequirementsTxt,
        missingDependencyType: hasVenv || !hasRequirementsTxt ? 'none' : 'python_venv',
        recommendedInstallCommand: installCmd,
        recommendedRunCommand: runCmd,
        tags,
        hasEnvExample,
        hasEnv,
        port,
      };
    }

    // --- Case 3: Pure Static HTML / JS (Vibe Coding Artifacts) ---
    if (hasIndexHtml) {
      return {
        id: generateId(),
        name: dirName,
        rootPath: dirPath,
        relativePath,
        type: 'static_html',
        framework: 'Static Web App (HTML/JS)',
        hasDependenciesInstalled: true,
        missingDependencyType: 'none',
        recommendedInstallCommand: undefined,
        recommendedRunCommand: 'npx serve . -p 3000',
        tags: ['Static HTML', 'Web'],
        hasEnvExample: false,
        hasEnv: false,
        port: 3000,
      };
    }

    // --- Case 4: Go ---
    if (hasGoMod) {
      return {
        id: generateId(),
        name: dirName,
        rootPath: dirPath,
        relativePath,
        type: 'go',
        framework: 'Go Module',
        hasDependenciesInstalled: true,
        missingDependencyType: 'none',
        recommendedInstallCommand: 'go mod download',
        recommendedRunCommand: 'go run .',
        tags: ['Go'],
        hasEnvExample,
        hasEnv,
      };
    }

    // --- Case 5: Rust ---
    if (hasCargoToml) {
      return {
        id: generateId(),
        name: dirName,
        rootPath: dirPath,
        relativePath,
        type: 'rust',
        framework: 'Rust Cargo',
        hasDependenciesInstalled: true,
        missingDependencyType: 'none',
        recommendedInstallCommand: 'cargo build',
        recommendedRunCommand: 'cargo run',
        tags: ['Rust'],
        hasEnvExample,
        hasEnv,
      };
    }

    // --- Case 6: Java ---
    if (hasPomXml || hasBuildGradle) {
      return {
        id: generateId(),
        name: dirName,
        rootPath: dirPath,
        relativePath,
        type: 'java',
        framework: hasPomXml ? 'Java Maven' : 'Java Gradle',
        hasDependenciesInstalled: true,
        missingDependencyType: 'none',
        recommendedInstallCommand: hasPomXml ? 'mvn compile' : 'gradle compileJava',
        recommendedRunCommand: hasPomXml ? 'mvn spring-boot:run' : 'gradle bootRun',
        tags: ['Java'],
        hasEnvExample,
        hasEnv,
      };
    }

    return null;
  }
}
