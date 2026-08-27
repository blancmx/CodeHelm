import { dialog, ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  ImportProjectInputSchema,
} from '@codehelm/contracts';
import {
  ProjectRepository,
} from '@codehelm/database';
import {
  readUtf8FileWithinLimit,
} from '@codehelm/analyzer';
import { normalizePath } from '@codehelm/shared';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectTasks } from './project-task-service.js';
import { getAnalysisTasks } from './analysis-service.js';
import type { AnalysisTasks } from './analysis-tasks.js';

const DEFAULT_FILE_TREE_DEPTH = 5;
const MAX_FILE_TREE_DEPTH = 5;
const MAX_FILE_TREE_NODES = 5_000;
const MAX_FILE_TREE_ENTRIES_PER_DIRECTORY = 2_000;
const MAX_README_BYTES = 256 * 1024;

function normalizeFileTreeDepth(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FILE_TREE_DEPTH;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid file tree depth');
  }
  return Math.min(value, MAX_FILE_TREE_DEPTH);
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

interface FileTreeBudget {
  nodes: number;
}

async function readDirectoryEntries(directoryPath: string): Promise<fs.Dirent[]> {
  const directory = await fs.promises.opendir(directoryPath);
  const entries: fs.Dirent[] = [];
  try {
    for await (const entry of directory) {
      if (entries.length >= MAX_FILE_TREE_ENTRIES_PER_DIRECTORY) break;
      entries.push(entry);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return entries;
}

export function registerProjectHandlers(db: DatabaseInstance, tasks: AnalysisTasks = getAnalysisTasks(db)) {
  const projectRepo = new ProjectRepository(db);
  const jobs = getProjectTasks(db, tasks);
  const owners = new WeakSet<Electron.WebContents>();
  const trackOwner = (event: Electron.IpcMainInvokeEvent) => {
    if (owners.has(event.sender)) return;
    owners.add(event.sender);
    event.sender.once('destroyed', () => { void jobs.stopActive(); });
  };
  const finishLegacy = async (taskId: string) => {
    const state = await jobs.wait(taskId);
    if (state.status !== 'completed') {
      throw new Error(state.errorMessage || state.results.find((item) => item.errorMessage)?.errorMessage || state.stage);
    }
    return state;
  };

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

  ipcMain.handle(IpcChannels.PROJECTS_START_SCAN, (event, input) => {
    trackOwner(event);
    return jobs.startScan(input);
  });
  ipcMain.handle(IpcChannels.PROJECTS_START_IMPORT, (event, input) => {
    trackOwner(event);
    return jobs.startImport(input);
  });
  ipcMain.handle(IpcChannels.PROJECTS_GET_TASK, (_event, taskId: string) => jobs.get(taskId));
  ipcMain.handle(IpcChannels.PROJECTS_CANCEL_TASK, (_event, taskId: string) => jobs.cancel(taskId));

  // Compatibility callers also use workers; partial failures must not masquerade as success.
  ipcMain.handle(IpcChannels.PROJECTS_SCAN_WORKSPACE, async (event, rootPath: string, options?: { maxDepth?: number }) => {
    trackOwner(event);
    const { taskId } = jobs.startScan({ rootPath, maxDepth: options?.maxDepth ?? 2 });
    return (await finishLegacy(taskId)).discovered;
  });
  ipcMain.handle(IpcChannels.PROJECTS_IMPORT, async (event, rawInput) => {
    trackOwner(event);
    const input = ImportProjectInputSchema.parse(rawInput);
    const { taskId } = jobs.startImport({ projects: [input] });
    return (await finishLegacy(taskId)).results[0].project!;
  });
  ipcMain.handle(IpcChannels.PROJECTS_BATCH_IMPORT, async (event, rawInput) => {
    trackOwner(event);
    const { taskId } = jobs.startImport(rawInput);
    return (await finishLegacy(taskId)).results.map((item) => item.project!);
  });

  ipcMain.handle(IpcChannels.PROJECTS_LIST, async () => {
    return projectRepo.list();
  });

  ipcMain.handle(IpcChannels.PROJECTS_GET, async (_event, id: string) => {
    return projectRepo.findById(id);
  });

  ipcMain.handle(IpcChannels.PROJECTS_REMOVE, async (_event, id: string) => {
    const project = projectRepo.findById(id);
    if (project) await jobs.stopForPath(project.rootPath);
    await tasks.cancelProject(id);
    projectRepo.delete(id);
    return { success: true };
  });

  ipcMain.handle(IpcChannels.PROJECTS_UPDATE, async (_event, id: string, patch: any) => {
    const project = projectRepo.findById(id);
    if (patch.rootPath && project) {
      await jobs.stopForPath(project.rootPath);
      await tasks.cancelProject(id);
    }
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

  async function buildFileTree(
    currentDir: string,
    rootDir: string,
    currentDepth: number,
    maxDepth: number,
    budget: FileTreeBudget
  ): Promise<any[]> {
    if (currentDepth > maxDepth || budget.nodes >= MAX_FILE_TREE_NODES) return [];
    try {
      const entries = await readDirectoryEntries(currentDir);
      const nodes: any[] = [];

      entries.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory() ? -1 : 1;
      });

      for (const entry of entries) {
        if (budget.nodes >= MAX_FILE_TREE_NODES) break;
        if (IGNORED_TREE_DIRS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        const normFull = normalizePath(fullPath);
        const relPath = normalizePath(path.relative(rootDir, fullPath));
        let entryStat: fs.Stats;
        try {
          entryStat = await fs.promises.lstat(fullPath);
        } catch {
          continue;
        }
        if (entryStat.isSymbolicLink()) continue;

        if (entryStat.isDirectory()) {
          budget.nodes += 1;
          const children = await buildFileTree(fullPath, rootDir, currentDepth + 1, maxDepth, budget);
          nodes.push({
            name: entry.name,
            path: normFull,
            relativePath: relPath,
            type: 'directory',
            children,
          });
        } else if (entryStat.isFile()) {
          budget.nodes += 1;
          const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '');
          nodes.push({
            name: entry.name,
            path: normFull,
            relativePath: relPath,
            type: 'file',
            size: entryStat.size,
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
    const maxDepth = normalizeFileTreeDepth(options?.maxDepth);
    return buildFileTree(normRoot, normRoot, 1, maxDepth, { nodes: 0 });
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
      if (isRegularFile(full)) {
        readmePath = full;
        break;
      }
    }

    if (!readmePath) {
      let directory: fs.Dir | undefined;
      try {
        directory = fs.opendirSync(normRoot);
        let entry: fs.Dirent | null;
        while ((entry = directory.readSync()) !== null) {
          if (entry.isSymbolicLink() || !entry.isFile()) continue;
          if (/^readme(\.[a-z0-9_-]+)?$/i.test(entry.name)) {
            readmePath = path.join(normRoot, entry.name);
            break;
          }
        }
      } catch {}
      finally {
        directory?.closeSync();
      }
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
      const rawContent = (await readUtf8FileWithinLimit(readmePath, MAX_README_BYTES)).text;
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
