import type {
  CodeHelmApi,
  ProjectDto,
  ProjectSummaryDto,
  DiscoveredProjectDto,
  ImportProjectInput,
  BatchImportInput,
  AnalysisSnapshotDto,
  RunProfileDto,
  RunSessionDto,
  RunnerExecutionMode,
  AppSettingsDto,
  ServiceStatusEventDto,
  LogBatchDto,
  FileTreeNodeDto,
  ReadmeSummaryDto,
} from '@codehelm/contracts';

const STORAGE_KEY_PROJECTS = 'codehelm_browser_mock_projects_v5';
const STORAGE_KEY_SETTINGS = 'codehelm_browser_mock_settings_v5';
const mockExecutionApprovals = new Set<string>();

function executionApprovalKey(profileId: string, mode: RunnerExecutionMode): string {
  return `${profileId}:${mode}`;
}

interface MockProjectData {
  project: ProjectDto;
  summary: ProjectSummaryDto;
  snapshot: AnalysisSnapshotDto;
  fileTree?: FileTreeNodeDto[];
  customProfile?: RunProfileDto;
}

function redactMockProfile(profile: RunProfileDto): { profile: RunProfileDto; changed: boolean } {
  let changed = false;
  const services = profile.services.map((service) => ({
    ...service,
    env: service.env.map((entry) => {
      if (!entry.isSecret) return { ...entry };
      if (entry.value || !entry.isRedacted) changed = true;
      return {
        key: entry.key,
        value: '',
        isSecret: true,
        isRedacted: true,
      };
    }),
  }));

  return {
    profile: { ...profile, services },
    changed,
  };
}

const defaultMockData: MockProjectData[] = [
  {
    project: {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'CodeHelm Desktop',
      rootPath: 'E:/Aai/AllProject/desk',
      tags: ['Desktop', 'Frontend', 'Electron'],
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      lastAnalyzedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      lastRunAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    summary: {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'CodeHelm Desktop',
      rootPath: 'E:/Aai/AllProject/desk',
      tags: ['Desktop', 'Frontend', 'Electron'],
      primaryLanguages: ['Vue', 'TypeScript'],
      primaryFrameworks: ['Vite', 'Pinia', 'UnoCSS'],
      moduleCount: 3,
      serviceCount: 2,
      lastRunStatus: 'RUNNING',
      lastRunAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      hasDependenciesInstalled: true,
      recommendedRunCommand: 'pnpm dev',
    },
    snapshot: {
      id: 'snap-00000000-0000-0000-0000-000000000001',
      projectId: 'a0000000-0000-0000-0000-000000000001',
      status: 'completed',
      analyzerVersion: '1.0.0',
      primaryLanguage: 'Vue',
      languages: [
        { language: 'Vue', fileCount: 24, percentage: 60 },
        { language: 'TypeScript', fileCount: 16, percentage: 40 },
      ],
      modules: [
        {
          id: 'mod-desk-1',
          snapshotId: 'snap-00000000-0000-0000-0000-000000000001',
          name: 'CodeHelm Desktop',
          relativePath: '.',
          moduleType: 'frontend',
          technologies: [
            {
              name: 'Vite',
              category: 'frontend_framework',
              confidence: 1,
              evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'vite dependency' }],
              source: 'detected',
            },
            {
              name: 'Vue 3',
              category: 'frontend_framework',
              confidence: 1,
              evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'vue 3 dependency' }],
              source: 'detected',
            },
          ],
        },
      ],
      startedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      completedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    fileTree: [
      {
        name: 'apps',
        path: 'apps',
        relativePath: 'apps',
        type: 'directory',
        children: [
          {
            name: 'desktop',
            path: 'apps/desktop',
            relativePath: 'apps/desktop',
            type: 'directory',
            children: [
              {
                name: 'src',
                path: 'apps/desktop/src',
                relativePath: 'apps/desktop/src',
                type: 'directory',
                children: [
                  { name: 'main.ts', path: 'apps/desktop/src/main.ts', relativePath: 'apps/desktop/src/main.ts', type: 'file', size: 2400, extension: 'ts' },
                  { name: 'App.vue', path: 'apps/desktop/src/App.vue', relativePath: 'apps/desktop/src/App.vue', type: 'file', size: 4800, extension: 'vue' },
                ],
              },
              { name: 'package.json', path: 'apps/desktop/package.json', relativePath: 'apps/desktop/package.json', type: 'file', size: 1200, extension: 'json' },
            ],
          },
        ],
      },
      {
        name: 'packages',
        path: 'packages',
        relativePath: 'packages',
        type: 'directory',
        children: [
          { name: 'contracts', path: 'packages/contracts', relativePath: 'packages/contracts', type: 'directory', children: [] },
          { name: 'analyzer', path: 'packages/analyzer', relativePath: 'packages/analyzer', type: 'directory', children: [] },
        ],
      },
      { name: 'package.json', path: 'package.json', relativePath: 'package.json', type: 'file', size: 1400, extension: 'json' },
      { name: 'pnpm-workspace.yaml', path: 'pnpm-workspace.yaml', relativePath: 'pnpm-workspace.yaml', type: 'file', size: 320, extension: 'yaml' },
      { name: 'README.md', path: 'README.md', relativePath: 'README.md', type: 'file', size: 2100, extension: 'md' },
    ],
  },
];

let lastDirectoryHandle: any = null;
const directoryHandleMap = new Map<string, any>();
const scannedMetadataMap = new Map<string, {
  languages: { language: string; fileCount: number; percentage: number }[];
  technologies: any[];
  frameworks: string[];
  command: string;
  port?: number;
  tags: string[];
  moduleType: 'frontend' | 'backend' | 'fullstack';
  fileTree: FileTreeNodeDto[];
}>();

function getStoredMockData(): MockProjectData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (raw) {
      const data: MockProjectData[] = JSON.parse(raw);
      let changed = false;
      for (const item of data) {
        if (item.project.rootPath?.startsWith('E:/projects/')) {
          item.project.rootPath = item.project.rootPath.replace('E:/projects/', 'E:/Aai/AllProject/');
          if (item.summary) {
            item.summary.rootPath = item.summary.rootPath?.replace('E:/projects/', 'E:/Aai/AllProject/');
          }
          changed = true;
        }
        if (item.customProfile) {
          const redacted = redactMockProfile(item.customProfile);
          if (redacted.changed) {
            item.customProfile = redacted.profile;
            changed = true;
          }
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(data));
      }
      return data;
    }
  } catch (e) {
    console.error('Failed to parse mock data from localStorage:', e);
  }
  localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(defaultMockData));
  return defaultMockData;
}

function saveStoredMockData(list: MockProjectData[]) {
  localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(list));
}

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to safely read file content as text from FileSystemDirectoryHandle
async function readTextFile(dirHandle: any, filename: string): Promise<string | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// 100% Genuine Recursive File Tree Extractor from Web FileSystemDirectoryHandle
async function extractRealFileTree(
  dirHandle: any,
  currentRel: string = '',
  currentDepth: number = 1,
  maxDepth: number = 6
): Promise<FileTreeNodeDto[]> {
  if (currentDepth > maxDepth) return [];
  const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', '.idea', '.vscode', 'target', '.next', '.nuxt']);
  const nodes: FileTreeNodeDto[] = [];
  const dirEntries: { name: string; handle: any }[] = [];
  const fileEntries: { name: string; handle: any }[] = [];

  try {
    for await (const [name, handle] of (dirHandle as any).entries()) {
      if (ignored.has(name)) continue;
      if (handle.kind === 'directory') {
        dirEntries.push({ name, handle });
      } else if (handle.kind === 'file') {
        fileEntries.push({ name, handle });
      }
    }
  } catch (err) {
    console.warn('Cannot read real directory entries:', err);
  }

  // Sort: directories first, then alphabetical
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));
  fileEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, handle } of dirEntries) {
    const rel = currentRel ? `${currentRel}/${name}` : name;
    const children = await extractRealFileTree(handle, rel, currentDepth + 1, maxDepth);
    nodes.push({
      name,
      path: rel,
      relativePath: rel,
      type: 'directory',
      children,
    });
  }

  for (const { name, handle } of fileEntries) {
    const rel = currentRel ? `${currentRel}/${name}` : name;
    let size = 0;
    try {
      const f = await handle.getFile();
      size = f.size;
    } catch {}
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    nodes.push({
      name,
      path: rel,
      relativePath: rel,
      type: 'file',
      size,
      extension: ext,
    });
  }

  return nodes;
}

// Dynamic Directory Analysis
async function analyzeDirectory(dirHandle: any, basePath: string, relativePath: string = ''): Promise<DiscoveredProjectDto | null> {
  const currentPath = relativePath ? `${basePath}/${relativePath}` : basePath;
  const folderName = dirHandle.name;

  // Extract the 100% REAL file tree from user's disk
  const realFileTree = await extractRealFileTree(dirHandle, '', 1, 5);

  // Extract direct files and subdirs
  const fileNames: string[] = [];
  const dirNames: string[] = [];
  for (const item of realFileTree) {
    if (item.type === 'file') fileNames.push(item.name);
    else if (item.type === 'directory') dirNames.push(item.name);
  }

  // Helper to count files in tree
  const langCountMap: Record<string, number> = {};
  function countFilesRecursively(nodes: FileTreeNodeDto[]) {
    for (const n of nodes) {
      if (n.type === 'file') {
        const ext = n.extension?.toLowerCase();
        if (ext === 'py') langCountMap['Python'] = (langCountMap['Python'] || 0) + 1;
        else if (ext === 'ts' || ext === 'tsx') langCountMap['TypeScript'] = (langCountMap['TypeScript'] || 0) + 1;
        else if (ext === 'vue') langCountMap['Vue'] = (langCountMap['Vue'] || 0) + 1;
        else if (ext === 'js' || ext === 'jsx') langCountMap['JavaScript'] = (langCountMap['JavaScript'] || 0) + 1;
        else if (ext === 'rs') langCountMap['Rust'] = (langCountMap['Rust'] || 0) + 1;
        else if (ext === 'go') langCountMap['Go'] = (langCountMap['Go'] || 0) + 1;
        else if (ext === 'java') langCountMap['Java'] = (langCountMap['Java'] || 0) + 1;
        else if (ext === 'html') langCountMap['HTML'] = (langCountMap['HTML'] || 0) + 1;
        else if (ext === 'css' || ext === 'scss') langCountMap['CSS'] = (langCountMap['CSS'] || 0) + 1;
      } else if (n.children) {
        countFilesRecursively(n.children);
      }
    }
  }
  countFilesRecursively(realFileTree);

  const pyFiles = fileNames.filter((f) => f.endsWith('.py'));
  const hasPackageJson = fileNames.includes('package.json');
  const hasEnv = fileNames.includes('.env') || fileNames.includes('.env.local');
  const hasEnvExample = fileNames.includes('.env.example') || fileNames.includes('example.env');

  let projectType: DiscoveredProjectDto['type'] = 'unknown';
  let framework = 'Python 3 Application';
  const frameworks: string[] = [];
  const tags: string[] = [];
  const technologies: any[] = [];
  let recommendedRunCommand = 'python main.py';
  let recommendedInstallCommand = 'pip install -r requirements.txt';
  let hasDependenciesInstalled = true;
  let missingDependencyType: DiscoveredProjectDto['missingDependencyType'] = 'none';
  let port: number | undefined = undefined;
  let moduleType: 'frontend' | 'backend' | 'fullstack' = 'backend';

  // ==========================================
  // CASE 1: Python Project (py files or manifests)
  // ==========================================
  if (
    pyFiles.length > 0 ||
    langCountMap['Python'] ||
    fileNames.includes('requirements.txt') ||
    fileNames.includes('pyproject.toml')
  ) {
    projectType = 'python';
    moduleType = 'backend';
    if (!langCountMap['Python']) langCountMap['Python'] = Math.max(pyFiles.length, 1);

    const reqContent =
      (await readTextFile(dirHandle, 'requirements.txt')) ||
      (await readTextFile(dirHandle, 'pyproject.toml')) ||
      '';

    let combinedPyCode = '';
    for (const pyF of pyFiles.slice(0, 5)) {
      const code = await readTextFile(dirHandle, pyF);
      if (code) combinedPyCode += '\n' + code;
    }

    const allPyText = (reqContent + '\n' + combinedPyCode).toLowerCase();

    // Determine Entry File (e.g. snake.py, game.py, main.py, app.py)
    const entryPy =
      pyFiles.find((f) => ['snake.py', 'game.py', 'main.py', 'app.py', 'run.py', 'index.py', 'server.py'].includes(f.toLowerCase())) ||
      pyFiles[0] ||
      'main.py';

    recommendedRunCommand = `python ${entryPy}`;

    // Detect Frameworks & Technologies
    if (allPyText.includes('pygame')) {
      framework = 'Pygame (Python Game)';
      frameworks.push('Pygame');
      tags.push('Pygame', 'Game', 'Python');
      technologies.push({
        name: 'Pygame',
        category: 'tooling',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'import pygame' }],
        source: 'detected',
      });
    } else if (allPyText.includes('turtle')) {
      framework = 'Turtle Graphics';
      frameworks.push('Turtle');
      tags.push('Turtle', 'Graphics', 'Python');
      technologies.push({
        name: 'Turtle Graphics',
        category: 'tooling',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'import turtle' }],
        source: 'detected',
      });
    } else if (allPyText.includes('tkinter')) {
      framework = 'Tkinter GUI';
      frameworks.push('Tkinter');
      tags.push('Tkinter', 'GUI', 'Python');
      technologies.push({
        name: 'Tkinter GUI',
        category: 'tooling',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'import tkinter' }],
        source: 'detected',
      });
    } else if (allPyText.includes('langchain') || allPyText.includes('llama_index') || allPyText.includes('rag')) {
      framework = 'LangChain AI Agent';
      frameworks.push('LangChain');
      tags.push('LangChain', 'AI', 'RAG');
      technologies.push({
        name: 'LangChain',
        category: 'backend_framework',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'LangChain AI orchestration' }],
        source: 'detected',
      });
    } else if (allPyText.includes('fastapi') || allPyText.includes('uvicorn')) {
      framework = 'FastAPI Backend';
      frameworks.push('FastAPI');
      tags.push('FastAPI', 'Backend', 'API');
      port = 8000;
      recommendedRunCommand = `uvicorn ${entryPy.replace('.py', '')}:app --reload`;
      technologies.push({
        name: 'FastAPI',
        category: 'backend_framework',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'fastapi application' }],
        source: 'detected',
      });
    } else if (allPyText.includes('flask')) {
      framework = 'Flask App';
      frameworks.push('Flask');
      tags.push('Flask', 'Backend');
      port = 5000;
      technologies.push({
        name: 'Flask',
        category: 'backend_framework',
        confidence: 1.0,
        evidence: [{ type: 'import', filePath: entryPy, detail: 'flask app' }],
        source: 'detected',
      });
    } else if (allPyText.includes('streamlit')) {
      framework = 'Streamlit AI App';
      frameworks.push('Streamlit');
      tags.push('Streamlit', 'AI', 'Dashboard');
      port = 8501;
      recommendedRunCommand = `streamlit run ${entryPy}`;
      technologies.push({
        name: 'Streamlit',
        category: 'frontend_framework',
        confidence: 1.0,
        evidence: [{ type: 'manifest', filePath: entryPy, detail: 'streamlit web interface' }],
        source: 'detected',
      });
    } else {
      framework = 'Python 3 Application';
      frameworks.push('Python 3');
      tags.push('Python', 'Script');
    }

    technologies.push({
      name: 'Python 3',
      category: 'language',
      confidence: 1.0,
      evidence: [{ type: 'filename', filePath: entryPy, detail: 'Python source file' }],
      source: 'detected',
    });

    const hasVenv = dirNames.includes('.venv') || dirNames.includes('venv') || dirNames.includes('env');
    if (fileNames.includes('requirements.txt')) {
      recommendedInstallCommand = 'pip install -r requirements.txt';
      if (!hasVenv) {
        hasDependenciesInstalled = false;
        missingDependencyType = 'python_venv';
      }
    }
  }

  // ==========================================
  // CASE 2: Node.js / Web Project
  // ==========================================
  else if (hasPackageJson || langCountMap['TypeScript'] || langCountMap['Vue'] || langCountMap['JavaScript']) {
    projectType = 'node';
    moduleType = 'frontend';

    let pkg: any = {};
    const pkgContent = await readTextFile(dirHandle, 'package.json');
    if (pkgContent) {
      try {
        pkg = JSON.parse(pkgContent);
      } catch {}
    }

    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};

    if (allDeps['vue']) {
      frameworks.push('Vue 3');
      framework = 'Vue 3';
      tags.push('Vue', 'Frontend');
      technologies.push({
        name: 'Vue 3',
        category: 'frontend_framework',
        confidence: 1.0,
        evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'vue 3 dependency' }],
        source: 'detected',
      });
    }
    if (allDeps['vite']) {
      frameworks.push('Vite');
      framework = framework === 'Vue 3' ? 'Vue 3 + Vite' : 'Vite';
      port = 5173;
      tags.push('Vite');
      technologies.push({
        name: 'Vite',
        category: 'tooling',
        confidence: 1.0,
        evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'vite build tool' }],
        source: 'detected',
      });
    }
    if (allDeps['next']) {
      frameworks.push('Next.js');
      framework = 'Next.js';
      port = 3000;
      tags.push('Next.js', 'React');
      technologies.push({
        name: 'Next.js',
        category: 'frontend_framework',
        confidence: 1.0,
        evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'next dependency' }],
        source: 'detected',
      });
    }
    if (allDeps['react'] && !allDeps['next']) {
      frameworks.push('React');
      framework = 'React';
      tags.push('React', 'Frontend');
      technologies.push({
        name: 'React',
        category: 'frontend_framework',
        confidence: 1.0,
        evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'react dependency' }],
        source: 'detected',
      });
    }

    if (frameworks.length === 0) {
      framework = 'Node.js Application';
      frameworks.push('Node.js');
      tags.push('Node.js');
    }

    if (fileNames.includes('pnpm-lock.yaml')) {
      recommendedRunCommand = scripts.dev ? 'pnpm dev' : 'pnpm start';
      recommendedInstallCommand = 'pnpm install';
    } else if (fileNames.includes('yarn.lock')) {
      recommendedRunCommand = scripts.dev ? 'yarn dev' : 'yarn start';
      recommendedInstallCommand = 'yarn install';
    } else {
      recommendedRunCommand = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : 'npm run dev';
      recommendedInstallCommand = 'npm install';
    }

    const hasNodeModules = dirNames.includes('node_modules');
    if (!hasNodeModules && hasPackageJson) {
      hasDependenciesInstalled = false;
      missingDependencyType = 'node_modules';
    }
  }

  // ==========================================
  // CASE 3: Rust / Go / HTML / Other
  // ==========================================
  else if (fileNames.includes('Cargo.toml') || langCountMap['Rust']) {
    projectType = 'rust';
    moduleType = 'backend';
    framework = 'Rust / Cargo';
    frameworks.push('Rust');
    tags.push('Rust', 'Systems');
    recommendedRunCommand = 'cargo run';
    recommendedInstallCommand = 'cargo build';
  } else if (fileNames.includes('go.mod') || langCountMap['Go']) {
    projectType = 'go';
    moduleType = 'backend';
    framework = 'Go Modules';
    frameworks.push('Go');
    tags.push('Go', 'Backend');
    recommendedRunCommand = 'go run .';
    recommendedInstallCommand = 'go mod tidy';
  } else {
    // Single file script or static folder
    projectType = realFileTree.length > 0 ? 'static_html' : 'unknown';
    framework = 'Application Directory';
    frameworks.push('Application');
    tags.push('Project');
    recommendedRunCommand = fileNames[0] ? `start ${fileNames[0]}` : 'dir';
  }

  if (projectType === 'unknown' && realFileTree.length === 0) {
    return null;
  }

  // Calculate Language distribution
  const totalLangFiles = Object.values(langCountMap).reduce((a, b) => a + b, 0) || 1;
  const languageStats = Object.entries(langCountMap).map(([lang, count]) => ({
    language: lang,
    fileCount: count,
    percentage: Math.round((count / totalLangFiles) * 100),
  }));

  const uniqueFrameworks = Array.from(new Set(frameworks));
  const uniqueTags = Array.from(new Set(tags.length > 0 ? tags : ['Project']));

  // Save metadata
  scannedMetadataMap.set(currentPath, {
    languages: languageStats.length > 0 ? languageStats : [{ language: 'Code', fileCount: realFileTree.length, percentage: 100 }],
    technologies,
    frameworks: uniqueFrameworks,
    command: recommendedRunCommand,
    port,
    tags: uniqueTags,
    moduleType,
    fileTree: realFileTree,
  });

  return {
    id: `disc-${generateUuid()}`,
    name: folderName,
    rootPath: currentPath,
    relativePath: relativePath || '.',
    type: projectType,
    framework,
    hasDependenciesInstalled,
    missingDependencyType,
    recommendedRunCommand,
    recommendedInstallCommand,
    tags: uniqueTags,
    hasEnvExample,
    hasEnv,
    port,
  };
}

export function setupBrowserMock() {
  const statusListeners = new Set<(event: ServiceStatusEventDto) => void>();
  const logListeners = new Set<(batch: LogBatchDto) => void>();

  const mockApi: CodeHelmApi = {
    projects: {
      async selectDirectory() {
        if (typeof (window as any).showDirectoryPicker === 'function') {
          try {
            const dirHandle = await (window as any).showDirectoryPicker();
            if (dirHandle) {
              lastDirectoryHandle = dirHandle;
              const normalizedPath = `E:/Aai/AllProject/${dirHandle.name}`;
              directoryHandleMap.set(normalizedPath, dirHandle);
              return {
                path: normalizedPath,
                name: dirHandle.name,
              };
            }
          } catch (err: any) {
            if (err.name === 'AbortError') {
              return null; // User cancelled
            }
          }
        }
        return {
          path: 'E:/Aai/AllProject/snake',
          name: 'snake',
        };
      },

      async scanWorkspace(rootPath: string): Promise<DiscoveredProjectDto[]> {
        const handle = directoryHandleMap.get(rootPath) || lastDirectoryHandle;
        if (handle) {
          const results: DiscoveredProjectDto[] = [];
          const ignoredDirs = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.nuxt', '.idea', '.vscode', '__pycache__', 'target']);

          // 1. Check if root itself is a project
          const rootProject = await analyzeDirectory(handle, rootPath, '');
          if (rootProject) {
            results.push(rootProject);
          }

          // 2. Check subdirectories
          try {
            for await (const [name, subHandle] of (handle as any).entries()) {
              if (subHandle.kind === 'directory' && !ignoredDirs.has(name)) {
                const subProject = await analyzeDirectory(subHandle, rootPath, name);
                if (subProject) {
                  results.push(subProject);
                }
              }
            }
          } catch (err) {
            console.warn('Error reading subdirectories:', err);
          }

          if (results.length > 0) {
            return results;
          }
        }

        // Dynamic fallback based on path name
        const folderName = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
        const isPythonOrGame =
          folderName.toLowerCase().includes('snake') ||
          folderName.toLowerCase().includes('game') ||
          folderName.toLowerCase().includes('py') ||
          folderName.toLowerCase().includes('rag') ||
          folderName.toLowerCase().includes('langchain') ||
          folderName.toLowerCase().includes('ai') ||
          folderName.toLowerCase().includes('fastapi');

        const primaryLangs = isPythonOrGame
          ? [{ language: 'Python', fileCount: 3, percentage: 100 }]
          : [{ language: 'Vue', fileCount: 12, percentage: 60 }, { language: 'TypeScript', fileCount: 8, percentage: 40 }];

        const primaryFramework = isPythonOrGame
          ? folderName.toLowerCase().includes('snake') ? 'Pygame (Python Game)' : 'Python 3 Application'
          : 'Vue 3 + Vite';

        const runCmd = isPythonOrGame
          ? folderName.toLowerCase().includes('snake') ? 'python snake.py' : 'python main.py'
          : 'pnpm dev';

        const pType = isPythonOrGame ? 'python' : 'node';

        scannedMetadataMap.set(rootPath, {
          languages: primaryLangs,
          frameworks: [primaryFramework],
          technologies: [
            {
              name: isPythonOrGame ? 'Python 3' : 'Vue 3',
              category: isPythonOrGame ? 'language' : 'frontend_framework',
              confidence: 1.0,
              evidence: [{ type: 'filename', filePath: isPythonOrGame ? 'snake.py' : 'package.json', detail: 'Source code' }],
              source: 'detected',
            },
          ],
          command: runCmd,
          port: isPythonOrGame ? undefined : 5173,
          tags: isPythonOrGame ? ['Python', 'Game'] : ['Vue', 'Frontend'],
          moduleType: isPythonOrGame ? 'backend' : 'frontend',
          fileTree: [
            { name: `${folderName}.py`, path: `${folderName}.py`, relativePath: `${folderName}.py`, type: 'file', size: 2800, extension: 'py' },
          ],
        });

        return [
          {
            id: `disc-${generateUuid()}`,
            name: folderName,
            rootPath: rootPath,
            relativePath: '.',
            type: pType as any,
            framework: primaryFramework,
            hasDependenciesInstalled: true,
            missingDependencyType: 'none',
            recommendedRunCommand: runCmd,
            tags: isPythonOrGame ? ['Python', 'Game'] : ['Vue', 'Frontend'],
            hasEnvExample: true,
            hasEnv: true,
            port: undefined,
          },
        ];
      },

      async list(): Promise<ProjectSummaryDto[]> {
        const list = getStoredMockData();
        return list.map((item) => item.summary);
      },

      async get(id: string): Promise<ProjectDto | null> {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === id);
        return found ? found.project : null;
      },

      async import(input: ImportProjectInput): Promise<ProjectDto> {
        const list = getStoredMockData();
        const folderName = input.name || input.rootPath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
        const id = generateUuid();
        const now = new Date().toISOString();

        const meta = scannedMetadataMap.get(input.rootPath);
        const isPython = meta?.languages?.some((l) => l.language === 'Python') || folderName.toLowerCase().includes('snake') || folderName.toLowerCase().includes('py');

        const langs = meta?.languages?.map((l) => l.language) || (isPython ? ['Python'] : ['Vue', 'TypeScript']);
        const frameworks = meta?.frameworks || (isPython ? ['Python 3'] : ['Vite']);
        const tags = meta?.tags || input.tags || (isPython ? ['Python'] : ['Frontend']);
        const runCmd = meta?.command || (isPython ? `python ${folderName.toLowerCase().includes('snake') ? 'snake.py' : 'main.py'}` : 'pnpm dev');

        const newProject: ProjectDto = {
          id,
          name: folderName,
          rootPath: input.rootPath,
          tags,
          createdAt: now,
          updatedAt: now,
          lastAnalyzedAt: now,
        };

        const newSummary: ProjectSummaryDto = {
          id,
          name: folderName,
          rootPath: input.rootPath,
          tags,
          primaryLanguages: langs,
          primaryFrameworks: frameworks,
          moduleCount: 1,
          serviceCount: 1,
          lastRunStatus: 'IDLE',
          hasDependenciesInstalled: true,
          recommendedRunCommand: runCmd,
        };

        const snapshot: AnalysisSnapshotDto = {
          id: `snap-${generateUuid()}`,
          projectId: id,
          status: 'completed',
          analyzerVersion: '1.0.0',
          primaryLanguage: langs[0] || 'Python',
          languages: meta?.languages || (isPython ? [{ language: 'Python', fileCount: 3, percentage: 100 }] : [{ language: 'Vue', fileCount: 10, percentage: 100 }]),
          modules: [
            {
              id: `mod-${generateUuid()}`,
              snapshotId: `snap-${id}`,
              name: folderName,
              relativePath: '.',
              moduleType: meta?.moduleType || (isPython ? 'backend' : 'frontend'),
              technologies: meta?.technologies || [
                {
                  name: frameworks[0] || (isPython ? 'Python 3' : 'Vite'),
                  category: isPython ? 'language' : 'frontend_framework',
                  confidence: 1.0,
                  evidence: [{ type: 'filename', filePath: isPython ? 'snake.py' : 'package.json', detail: 'Source code' }],
                  source: 'detected',
                },
              ],
            },
          ],
          startedAt: now,
          completedAt: now,
        };

        const realTree = meta?.fileTree || [];

        list.unshift({ project: newProject, summary: newSummary, snapshot, fileTree: realTree });
        saveStoredMockData(list);
        return newProject;
      },

      async batchImport(input: BatchImportInput): Promise<ProjectDto[]> {
        const list = getStoredMockData();
        const createdProjects: ProjectDto[] = [];

        for (const item of input.projects) {
          const folderName = item.name || item.rootPath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
          const id = generateUuid();
          const now = new Date().toISOString();

          const meta = scannedMetadataMap.get(item.rootPath);
          const isPython = meta?.languages?.some((l) => l.language === 'Python') || folderName.toLowerCase().includes('snake') || folderName.toLowerCase().includes('py');

          const langs = meta?.languages?.map((l) => l.language) || (isPython ? ['Python'] : ['Vue', 'TypeScript']);
          const frameworks = meta?.frameworks || (isPython ? ['Python 3'] : ['Vite']);
          const tags = meta?.tags || item.tags || (isPython ? ['Python'] : ['Frontend']);
          const runCmd = meta?.command || (isPython ? `python ${folderName.toLowerCase().includes('snake') ? 'snake.py' : 'main.py'}` : 'pnpm dev');

          const newP: ProjectDto = {
            id,
            name: folderName,
            rootPath: item.rootPath,
            tags,
            createdAt: now,
            updatedAt: now,
            lastAnalyzedAt: now,
          };

          const newSummary: ProjectSummaryDto = {
            id,
            name: folderName,
            rootPath: item.rootPath,
            tags,
            primaryLanguages: langs,
            primaryFrameworks: frameworks,
            moduleCount: 1,
            serviceCount: 1,
            lastRunStatus: 'IDLE',
            hasDependenciesInstalled: true,
            recommendedRunCommand: runCmd,
          };

          const snapshot: AnalysisSnapshotDto = {
            id: `snap-${generateUuid()}`,
            projectId: id,
            status: 'completed',
            analyzerVersion: '1.0.0',
            primaryLanguage: langs[0] || 'Python',
            languages: meta?.languages || (isPython ? [{ language: 'Python', fileCount: 3, percentage: 100 }] : [{ language: 'Vue', fileCount: 10, percentage: 100 }]),
            modules: [
              {
                id: `mod-${generateUuid()}`,
                snapshotId: `snap-${id}`,
                name: folderName,
                relativePath: '.',
                moduleType: meta?.moduleType || (isPython ? 'backend' : 'frontend'),
                technologies: meta?.technologies || [
                  {
                    name: frameworks[0] || (isPython ? 'Python 3' : 'Vite'),
                    category: isPython ? 'language' : 'frontend_framework',
                    confidence: 1.0,
                    evidence: [{ type: 'filename', filePath: isPython ? 'snake.py' : 'package.json', detail: 'Source code' }],
                    source: 'detected',
                  },
                ],
              },
            ],
            startedAt: now,
            completedAt: now,
          };

          const realTree = meta?.fileTree || [];

          list.unshift({ project: newP, summary: newSummary, snapshot, fileTree: realTree });
          createdProjects.push(newP);
        }

        saveStoredMockData(list);
        return createdProjects;
      },

      async remove(id: string): Promise<void> {
        const list = getStoredMockData().filter((item) => item.project.id !== id);
        saveStoredMockData(list);
      },

      async update(id: string, patch: Partial<ProjectDto>): Promise<ProjectDto | null> {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === id);
        if (!found) return null;

        const oldRoot = found.project.rootPath;
        Object.assign(found.project, patch);
        found.project.updatedAt = new Date().toISOString();

        if (patch.name) found.summary.name = patch.name;
        if (patch.rootPath) {
          found.summary.rootPath = patch.rootPath;
          const handle = directoryHandleMap.get(oldRoot);
          if (handle) {
            directoryHandleMap.set(patch.rootPath, handle);
          }
          const meta = scannedMetadataMap.get(oldRoot);
          if (meta) {
            scannedMetadataMap.set(patch.rootPath, meta);
          }
        }
        if (patch.tags) found.summary.tags = patch.tags;

        saveStoredMockData(list);
        return found.project;
      },

      async getFileTree(rootPath: string, options?: { maxDepth?: number }): Promise<FileTreeNodeDto[]> {
        const handle = directoryHandleMap.get(rootPath) || lastDirectoryHandle;
        if (handle) {
          const maxDepth = options?.maxDepth ?? 6;
          const liveTree = await extractRealFileTree(handle, '', 1, maxDepth);
          if (liveTree.length > 0) return liveTree;
        }

        // Return the stored real file tree for this project
        const list = getStoredMockData();
        const found = list.find((item) => item.project.rootPath === rootPath);
        if (found?.fileTree && found.fileTree.length > 0) {
          return found.fileTree;
        }

        const meta = scannedMetadataMap.get(rootPath);
        if (meta?.fileTree && meta.fileTree.length > 0) {
          return meta.fileTree;
        }

        return [];
      },

      async getReadmeSummary(rootPath: string): Promise<ReadmeSummaryDto> {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.rootPath === rootPath);
        const name = found?.project.name || 'Project';
        const isCodeHelm = name.toLowerCase().includes('codehelm') || name.toLowerCase().includes('desk');
        const isLangChain = name.toLowerCase().includes('langchain') || name.toLowerCase().includes('rag');

        if (isCodeHelm) {
          return {
            hasReadme: true,
            title: 'CodeHelm',
            description: '本地项目控制台与多进程自动化运行中心，面向 AI & Vibe Coding 时代的现代化桌面工作台。',
            features: [
              '智能工程探测与静态画像生成，自动识别主导语言与框架拓扑',
              '多服务一键协同编排拉起，进程树防孤儿安全清理机制',
              '自研动态端口分配与防冲突，支持一键打开前端界面与 API 文档',
              '纯本地优先与数据隔离，SQLite 嵌入式存储，零云端代码上传',
            ],
          };
        }

        if (isLangChain) {
          return {
            hasReadme: true,
            title: 'LangChain RAG Knowledge Base',
            description: '基于 FastAPI 与 Vue 3 的端到端企业级大模型检索增强生成 (RAG) 知识库系统。',
            features: [
              '混合向量检索与知识库切片重排 (Hybrid Rerank)',
              'FastAPI 异步高性能流式对话接口 (SSE)',
              'Vue 3 + Vite 现代化前端对话与文档管理界面',
              '多数据源连接器支持 PDF, Markdown 与网页内容导入',
            ],
          };
        }

        return {
          hasReadme: true,
          title: name,
          description: `基于 ${found?.summary.primaryLanguages?.join(' / ') || '多语言'} 构建的现代化代码工程。`,
          features: [
            `内置 ${found?.summary.primaryFrameworks?.join('、') || '核心'} 技术框架与自动化启动支持`,
            '支持单进程/多服务编排拉起与实时终端日志分流监控',
            '本地持久化环境配置与端口防冲突自动映射',
          ],
        };
      },
    },

    analysis: {
      async start(projectId: string) {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === projectId);
        if (found) {
          found.project.lastAnalyzedAt = new Date().toISOString();
          saveStoredMockData(list);
        }
        return { taskId: `task-${projectId}` };
      },
      async cancel() {},
      async getLatest(projectId: string): Promise<AnalysisSnapshotDto | null> {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === projectId);
        if (found && found.snapshot) {
          return found.snapshot;
        }

        const p = found?.summary;
        const mainLang = p?.primaryLanguages?.[0] || 'Python';
        const isPython = mainLang === 'Python';

        return {
          id: generateUuid(),
          projectId,
          status: 'completed',
          analyzerVersion: '1.0.0',
          primaryLanguage: mainLang,
          languages: (p?.primaryLanguages || ['Python']).map((lang, _idx, arr) => ({
            language: lang,
            fileCount: isPython ? 3 : 15,
            percentage: Math.round(100 / arr.length),
          })),
          modules: [
            {
              id: 'mod-1',
              snapshotId: generateUuid(),
              name: p?.name || 'Main Module',
              relativePath: '.',
              moduleType: isPython ? 'backend' : 'frontend',
              technologies: (p?.primaryFrameworks || ['Python 3']).map((fw) => ({
                name: fw,
                category: fw.includes('Vue') || fw.includes('React') ? 'frontend_framework' : isPython ? 'tooling' : 'backend_framework',
                confidence: 1.0,
                evidence: [{ type: 'filename', filePath: isPython ? 'snake.py' : 'package.json', detail: fw }],
                source: 'detected',
              })),
            },
          ],
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
      onProgress() {
        return () => {};
      },
    },

    profiles: {
      async save(input) {
        if (input.id) {
          mockExecutionApprovals.delete(executionApprovalKey(input.id, 'start'));
          mockExecutionApprovals.delete(executionApprovalKey(input.id, 'install'));
        }
        const profile: RunProfileDto = {
          id: input.id || generateUuid(),
          projectId: input.projectId,
          name: input.name,
          isDefault: input.isDefault ?? true,
          failurePolicy: input.failurePolicy || 'continue',
          services: input.services || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const safeProfile = redactMockProfile(profile).profile;
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === input.projectId);
        if (found) {
          found.customProfile = safeProfile;
          saveStoredMockData(list);
        }
        return safeProfile;
      },
      async list(projectId: string): Promise<RunProfileDto[]> {
        const list = getStoredMockData();
        const found = list.find((item) => item.project.id === projectId);
        if (found?.customProfile) {
          return [redactMockProfile(found.customProfile).profile];
        }

        const folderName = found?.project.name || 'Project';
        const fileTree = found?.fileTree || [];
        const isLangChainOrRag =
          folderName.toLowerCase().includes('langchain') ||
          folderName.toLowerCase().includes('rag') ||
          found?.project.tags.some((t) => t.toLowerCase().includes('rag') || t.toLowerCase().includes('langchain'));

        const hasFrontendDir = fileTree.some((f) => f.type === 'directory' && ['frontend', 'web', 'client', 'ui'].includes(f.name.toLowerCase()));
        const hasBackendDir = fileTree.some((f) => f.type === 'directory' && ['backend', 'server', 'api'].includes(f.name.toLowerCase()));

        const shortId = projectId.replace(/-/g, '').slice(0, 8);

        // Fullstack Project (e.g. LangChainRAG or any project with frontend + backend subdirs)
        if (isLangChainOrRag || (hasFrontendDir && hasBackendDir)) {
          const profileId = `prof-${shortId}-fullstack`;
          const srvBackendId = `srv-${shortId}-backend`;
          const srvFrontendId = `srv-${shortId}-frontend`;

          return [
            {
              id: profileId,
              projectId,
              name: '全栈协同启动方案 (前后端联动)',
              isDefault: true,
              failurePolicy: 'continue',
              services: [
                {
                  id: srvBackendId,
                  runProfileId: profileId,
                  name: 'Backend API (FastAPI / LangChain)',
                  type: 'backend',
                  moduleRelativePath: 'backend',
                  executable: '.venv/Scripts/python.exe',
                  args: ['-m', 'app.main'],
                  cwdRelative: 'backend',
                  env: [],
                  port: 8000,
                  dependsOn: [],
                  enabled: true,
                  source: 'detected',
                  healthCheck: { type: 'tcp', port: 8000 },
                },
                {
                  id: srvFrontendId,
                  runProfileId: profileId,
                  name: 'Frontend Web (Vue / Vite)',
                  type: 'frontend',
                  moduleRelativePath: 'frontend',
                  executable: 'npm',
                  args: ['run', 'dev'],
                  cwdRelative: 'frontend',
                  env: [],
                  port: 5173,
                  dependsOn: [srvBackendId],
                  enabled: true,
                  source: 'detected',
                  healthCheck: { type: 'tcp', port: 5173 },
                },
              ],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        }

        // Single service project
        const cmd = found?.summary.recommendedRunCommand || 'python main.py';
        const parts = cmd.split(' ');
        const executable = parts[0] || 'python';
        const args = parts.slice(1);
        const isPython = found?.summary.primaryLanguages?.includes('Python');
        const port = isPython ? undefined : 5173;
        const profileId = `prof-${shortId}-main`;
        const srvDefaultId = `srv-${shortId}-default`;

        return [
          {
            id: profileId,
            projectId,
            name: '默认受控启动配置',
            isDefault: true,
            failurePolicy: 'continue',
            services: [
              {
                id: srvDefaultId,
                runProfileId: profileId,
                name: `${found?.summary.name || 'Main'} Process`,
                type: isPython ? 'backend' : 'frontend',
                moduleRelativePath: '.',
                executable,
                args,
                cwdRelative: '.',
                env: [],
                port,
                dependsOn: [],
                enabled: true,
                source: 'detected',
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      },
      async get(id: string): Promise<RunProfileDto | null> {
        return {
          id,
          projectId: generateUuid(),
          name: '默认受控启动配置',
          isDefault: true,
          failurePolicy: 'continue',
          services: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    },

    runner: {
      async confirmExecution(_profileId: string, _mode: RunnerExecutionMode): Promise<string> {
        mockExecutionApprovals.add(executionApprovalKey(_profileId, _mode));
        return 'browser-mock-execution-approval';
      },

      async reuseExecutionApproval(profileId: string, mode: RunnerExecutionMode): Promise<string> {
        if (!mockExecutionApprovals.has(executionApprovalKey(profileId, mode))) {
          throw new Error('Execution confirmation required or expired.');
        }
        return 'browser-mock-execution-approval';
      },

      async start(profileId: string, _approvalToken: string): Promise<RunSessionDto> {
        const sessionId = generateUuid();
        const list = getStoredMockData();
        let targetProfile: RunProfileDto | undefined;
        let targetProjectId = '';

        for (const item of list) {
          const profs = await mockApi.profiles.list(item.project.id);
          const matched = profs.find((p) => p.id === profileId);
          if (matched) {
            targetProfile = matched;
            targetProjectId = item.project.id;
            break;
          }
        }

        if (!targetProjectId && list.length > 0) {
          targetProjectId = list[0].project.id;
        }

        const shortId = targetProjectId ? targetProjectId.replace(/-/g, '').slice(0, 8) : 'default';

        const servicesToStart = targetProfile?.services || [
          {
            id: `srv-${shortId}-default`,
            name: 'Main Process',
            type: 'backend' as const,
            executable: 'python',
            args: ['main.py'],
            port: undefined,
          },
        ];

        const sessionServices = servicesToStart.map((srv, idx) => ({
          id: `ss-${shortId}-${idx + 1}`,
          runSessionId: sessionId,
          serviceConfigId: srv.id,
          serviceName: srv.name,
          serviceType: srv.type,
          status: 'RUNNING' as const,
          pid: 18490 + idx,
          port: srv.port,
          startedAt: new Date().toISOString(),
          projectId: targetProjectId,
        }));

        for (const s of sessionServices) {
          directoryHandleMap.set(s.id, s);
          directoryHandleMap.set(s.serviceConfigId, s);
        }

        const session: RunSessionDto = {
          id: sessionId,
          projectId: targetProjectId || targetProfile?.projectId || generateUuid(),
          runProfileId: profileId,
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
          services: sessionServices,
        };

        // Emit status for each service
        setTimeout(() => {
          for (const s of sessionServices) {
            statusListeners.forEach((fn) =>
              fn({
                projectId: session.projectId,
                runSessionId: sessionId,
                serviceSessionId: s.id,
                serviceConfigId: s.serviceConfigId,
                serviceName: s.serviceName,
                status: 'RUNNING',
                pid: s.pid,
                port: s.port,
              })
            );
          }

          // Emit realistic logs
          for (const s of sessionServices) {
            const isBackend = s.serviceType === 'backend' || s.serviceName.toLowerCase().includes('backend') || s.serviceName.toLowerCase().includes('fastapi');
            const logsList = isBackend
              ? [
                  `➜  [INFO] Spawning Backend Process PID: ${s.pid}`,
                  `➜  INFO:     Will watch for changes in 'backend/'`,
                  `➜  INFO:     Uvicorn running on http://127.0.0.1:${s.port || 8000} (Press CTRL+C to quit)`,
                  `➜  INFO:     LangChain RAG engine initialized. Vector Store loaded.`,
                  `➜  INFO:     Application startup complete. Ready for API requests.`,
                ]
              : [
                  `➜  [INFO] Spawning Frontend Web Server PID: ${s.pid}`,
                  `  VITE v5.4.2  ready in 280 ms`,
                  `  ➜  Local:   http://localhost:${s.port || 5173}/`,
                  `  ➜  Network: use --host to expose`,
                  `  ➜  press h + enter to show help`,
                ];

            logListeners.forEach((fn) =>
              fn({
                projectId: session.projectId,
                runSessionId: sessionId,
                entries: logsList.map((msg) => ({
                  id: generateUuid(),
                  serviceSessionId: s.id,
                  serviceName: s.serviceName,
                  timestamp: new Date().toISOString(),
                  stream: 'stdout' as const,
                  message: msg,
                })),
              })
            );
          }
        }, 100);

        return session;
      },

      async installAndStart(profileId: string, approvalToken: string) {
        return this.start(profileId, approvalToken);
      },

      async stopSession(sessionId: string) {
        directoryHandleMap.forEach((val, key) => {
          if (val && typeof val === 'object' && val.runSessionId === sessionId) {
            statusListeners.forEach((fn) =>
              fn({
                projectId: val.projectId || '',
                runSessionId: sessionId,
                serviceSessionId: val.id || key,
                serviceConfigId: val.serviceConfigId || key,
                serviceName: val.serviceName || 'Service',
                status: 'STOPPED',
              })
            );
          }
        });
      },

      async stopService(serviceSessionId: string) {
        const val = directoryHandleMap.get(serviceSessionId);
        if (val) {
          statusListeners.forEach((fn) =>
            fn({
              projectId: val.projectId || '',
              runSessionId: val.runSessionId || '',
              serviceSessionId: val.id || serviceSessionId,
              serviceConfigId: val.serviceConfigId || serviceSessionId,
              serviceName: val.serviceName || 'Service Process',
              status: 'STOPPED',
            })
          );
        }
      },

      async restartService(serviceSessionId: string) {
        statusListeners.forEach((fn) =>
          fn({
            projectId: generateUuid(),
            runSessionId: '',
            serviceSessionId,
            serviceConfigId: 'srv-backend',
            serviceName: 'Backend API',
            status: 'RUNNING',
            pid: 18499,
            port: 8000,
          })
        );
      },

      onStatus(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },

      onLogs(listener) {
        logListeners.add(listener);
        return () => logListeners.delete(listener);
      },
    },

    settings: {
      async get(): Promise<AppSettingsDto> {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
          if (raw) return JSON.parse(raw);
        } catch {}
        return {
          theme: 'dark',
          defaultTerminal: 'powershell',
          maxScanFiles: 50000,
          maxLogRetentionDays: 14,
          maxLogRetentionMb: 500,
          enableAnonymousTelemetry: false,
        };
      },
      async update(patch) {
        const current = await this.get();
        const updated = { ...current, ...patch };
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
        return updated;
      },
    },

    window: {
      async minimize() {},
      async toggleMaximize() {
        return false;
      },
      async close() {},
      async isMaximized() {
        return false;
      },
      onMaximizeChange(_listener) {
        return () => {};
      },
    },
  };

  (window as any).codehelm = mockApi;
}
