import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import type { Dir } from 'node:fs';
import path from 'node:path';
import type { DiscoveredProjectDto } from '@codehelm/contracts';
import { generateId, normalizePath } from '@codehelm/shared';
import { parseJson } from '../parsers/index.js';
import { readUtf8FileWithinLimit } from '../io/bounded-read.js';

export interface WorkspaceScannerOptions {
  maxDepth?: number;
}

export const DEFAULT_WORKSPACE_SCAN_DEPTH = 2;
export const MAX_WORKSPACE_SCAN_DEPTH = 4;
export const MAX_WORKSPACE_SCAN_RESULTS = 500;
export const MAX_WORKSPACE_SCAN_ENTRIES_PER_DIRECTORY = 2_000;
export const MAX_WORKSPACE_INSPECTION_FILE_BYTES = 512 * 1024;
export const MAX_WORKSPACE_PYTHON_FILES = 200;

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

function isRegularFile(filePath: string): boolean {
  try {
    return fsSync.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fsSync.lstatSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeMaxDepth(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WORKSPACE_SCAN_DEPTH;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid workspace scan depth');
  }
  return Math.min(value, MAX_WORKSPACE_SCAN_DEPTH);
}

async function readInspectionFile(filePath: string): Promise<string> {
  return (await readUtf8FileWithinLimit(filePath, MAX_WORKSPACE_INSPECTION_FILE_BYTES)).text;
}

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
    const maxDepth = normalizeMaxDepth(options.maxDepth);
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
    if (currentDepth > maxDepth || results.length >= MAX_WORKSPACE_SCAN_RESULTS) return;

    let directory: Dir;
    try {
      directory = await fs.opendir(currentDir);
    } catch {
      return;
    }

    let inspectedEntries = 0;
    try {
      for await (const directoryEntry of directory) {
        if (
          inspectedEntries >= MAX_WORKSPACE_SCAN_ENTRIES_PER_DIRECTORY
          || results.length >= MAX_WORKSPACE_SCAN_RESULTS
        ) break;
        inspectedEntries += 1;

        const entry = directoryEntry.name;
        if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;

        const subPath = path.join(currentDir, entry);
        let stat;
        try {
          stat = await fs.lstat(subPath);
        } catch {
          continue;
        }

        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;

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
    } finally {
      await directory.close().catch(() => undefined);
    }
  }

  private async inspectDirectory(dirPath: string, workspaceRoot: string): Promise<DiscoveredProjectDto | null> {
    const dirName = path.basename(dirPath) || 'project';
    const relativePath = path.relative(workspaceRoot, dirPath) || '.';

    const hasPackageJson = isRegularFile(path.join(dirPath, 'package.json'));
    const hasRequirementsTxt = isRegularFile(path.join(dirPath, 'requirements.txt'));
    const hasPyproject = isRegularFile(path.join(dirPath, 'pyproject.toml'));
    const hasPipfile = isRegularFile(path.join(dirPath, 'Pipfile'));
    const hasMainPy = isRegularFile(path.join(dirPath, 'main.py')) || isRegularFile(path.join(dirPath, 'app.py'));
    const hasIndexHtml = isRegularFile(path.join(dirPath, 'index.html'));
    const hasCargoToml = isRegularFile(path.join(dirPath, 'Cargo.toml'));
    const hasGoMod = isRegularFile(path.join(dirPath, 'go.mod'));
    const hasPomXml = isRegularFile(path.join(dirPath, 'pom.xml'));
    const hasBuildGradle = isRegularFile(path.join(dirPath, 'build.gradle'));

    const hasEnvExample =
      isRegularFile(path.join(dirPath, '.env.example')) || isRegularFile(path.join(dirPath, '.env.sample'));
    const hasEnv = isRegularFile(path.join(dirPath, '.env'));

    // --- Case 1: Node.js / Web Project ---
    if (hasPackageJson) {
      let pkg: any = {};
      try {
        const pkgContent = await readInspectionFile(path.join(dirPath, 'package.json'));
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
        if (isRegularFile(path.join(lockSearchPath, 'pnpm-lock.yaml'))) {
          pm = 'pnpm';
          break;
        }
        if (isRegularFile(path.join(lockSearchPath, 'yarn.lock'))) {
          pm = 'yarn';
          break;
        }
        if (isRegularFile(path.join(lockSearchPath, 'bun.lockb')) || isRegularFile(path.join(lockSearchPath, 'bun.lock'))) {
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
      const hasNodeModules = isDirectory(path.join(dirPath, 'node_modules'));

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
        if (depth > 2 || pythonFiles.length >= MAX_WORKSPACE_PYTHON_FILES) return;
        const directory = fsSync.opendirSync(currentPath);
        try {
          let entry: fsSync.Dirent | null;
          while (
            pythonFiles.length < MAX_WORKSPACE_PYTHON_FILES
            && (entry = directory.readSync()) !== null
          ) {
            if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
            const relativeEntry = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
            if (entry.isFile() && entry.name.endsWith('.py')) pythonFiles.push(relativeEntry);
            else if (entry.isDirectory()) {
              collectPythonFiles(path.join(currentPath, entry.name), relativeEntry, depth + 1);
            }
          }
        } finally {
          directory.closeSync();
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
          reqContent = await readInspectionFile(path.join(dirPath, 'requirements.txt'));
        } catch {
          // ignore
        }
      }
      if (hasPyproject) {
        try {
          reqContent += '\n' + await readInspectionFile(path.join(dirPath, 'pyproject.toml'));
        } catch {}
      }
      if (hasPipfile) {
        try {
          reqContent += '\n' + await readInspectionFile(path.join(dirPath, 'Pipfile'));
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
          const code = await readInspectionFile(path.join(dirPath, pyF));
          combinedPyCode += '\n' + code;
          pythonCode.set(pyF, code);
        } catch {}
      }

      const allPyText = (reqContent + '\n' + combinedPyCode).toLowerCase();

      const isStreamlit =
        allPyText.includes('streamlit') ||
        isRegularFile(path.join(dirPath, 'streamlit_app.py')) ||
        isRegularFile(path.join(dirPath, 'app_streamlit.py'));
      const isFastAPI = allPyText.includes('fastapi') || allPyText.includes('uvicorn');
      const isFlask = allPyText.includes('flask');
      const isGradio = allPyText.includes('gradio');
      const isDjango = isRegularFile(path.join(dirPath, 'manage.py')) || allPyText.includes('django');
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
      const usesUv = isRegularFile(path.join(dirPath, 'uv.lock')) || /\[tool\.uv\]/i.test(reqContent);
      const usesPoetry = isRegularFile(path.join(dirPath, 'poetry.lock')) || /\[tool\.poetry\]/i.test(reqContent);
      const pythonPrefix = usesUv ? 'uv run ' : usesPoetry ? 'poetry run ' : '';

      let runCmd = `python ${primaryEntryPy}`;
      if (isStreamlit) {
        framework = 'Streamlit AI App';
        port = 8501;
        const targetFile = isRegularFile(path.join(dirPath, 'streamlit_app.py'))
          ? 'streamlit_app.py'
          : isRegularFile(path.join(dirPath, 'app.py'))
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
        isDirectory(path.join(dirPath, '.venv')) ||
        isDirectory(path.join(dirPath, 'venv')) ||
        isDirectory(path.join(dirPath, 'env'));

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
