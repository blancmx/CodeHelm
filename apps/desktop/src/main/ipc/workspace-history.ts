import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProjectRepository } from '@codehelm/database';
import type { DiscoveredProjectDto, SavedWorkspace, WorkspaceInventory, WorkspaceScanInput, WorkspaceEntry } from '@codehelm/contracts';

const canonical = (value: string) => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value.replace(/\\/g, '/');
function physicalRoot(root: string): string {
  try { return fs.realpathSync.native(root); }
  catch { return root; } // An unavailable workspace retains its last known association.
}
const keyFor = (root: string) => `workspace-v02:${createHash('sha256').update(canonical(root)).digest('hex')}`;
interface StoredWorkspace extends SavedWorkspace { baseline?: WorkspaceInventory; baselineRules?: string; candidates?: string[]; pendingChanges?: Record<string, { files: string[]; since: string }> }

export class WorkspaceHistory {
  constructor(private db: DatabaseInstance) {}
  private read(root: string): StoredWorkspace | undefined {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(keyFor(root)) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  list(): SavedWorkspace[] {
    const rows = this.db.prepare("SELECT value FROM app_settings WHERE key LIKE 'workspace-v02:%' ORDER BY key").all() as { value: string }[];
    const managed = new Map(new ProjectRepository(this.db).list().map(project => [canonical(project.rootPath), project.id]));
    return rows.map(row => {
      const { baseline: _baseline, baselineRules: _rules, candidates: _candidates, pendingChanges: _pending, ...visible } = JSON.parse(row.value) as StoredWorkspace;
      const physical = physicalRoot(visible.rootPath);
      visible.entries = visible.entries.map(entry => {
        const projectId = managed.get(canonical(path.resolve(physical, entry.relativePath)))
          ?? managed.get(canonical(path.resolve(visible.rootPath, entry.relativePath)));
        return { ...entry, projectId, status: entry.status === 'new' || entry.status === 'managed' ? projectId ? 'managed' : 'new' : entry.status };
      });
      return visible;
    });
  }
  save(input: WorkspaceScanInput, inventory: WorkspaceInventory, discovered: DiscoveredProjectDto[]) {
    const old = this.read(input.rootPath);
    if (!old && this.list().length >= 50) throw new Error('最多保存 50 个工作区');
    const excludeDirs = input.excludeDirs ?? [];
    const rules = JSON.stringify({ maxDepth: input.maxDepth, excludeDirs: [...excludeDirs].sort(), version: 1 });
    const comparable = old?.baselineRules === rules;
    const repository = new ProjectRepository(this.db);
    const projects = repository.list();
    const managed = new Map(projects.map(project => [canonical(project.rootPath), project.id]));
    const physical = physicalRoot(input.rootPath);
    const currentPaths = discovered.map(item => item.relativePath.replace(/\\/g, '/'));
    const allPaths = new Set([...currentPaths, ...(old?.candidates ?? [])]);
    const current = new Set(currentPaths);
    const entries: WorkspaceEntry[] = [];
    const checkedAt = new Date().toISOString();
    const pendingChanges: NonNullable<StoredWorkspace['pendingChanges']> = {};
    for (const relativePath of allPaths) {
      const absolute = path.resolve(input.rootPath, relativePath);
      const projectId = managed.get(canonical(path.resolve(physical, relativePath))) ?? managed.get(canonical(absolute));
      const prefix = relativePath === '.' ? '' : `${relativePath}/`;
      const related = (file: string) => file.startsWith(prefix);
      const files = new Set([...Object.keys(old?.baseline?.files ?? {}), ...Object.keys(inventory.files)].filter(related));
      let changedFiles = comparable ? [...files].filter(file => old?.baseline?.files[file] !== inventory.files[file]).sort() : [];
      const prior = old?.entries.find(entry => entry.relativePath === relativePath);
      const project = projectId ? repository.findById(projectId) : null;
      const pending = old?.pendingChanges?.[relativePath] ?? (prior?.status === 'changed' ? { files: prior.changedFiles, since: old?.checkedAt ?? checkedAt } : undefined);
      const newlyChanged = changedFiles.length > 0;
      if (pending && (!project?.lastAnalyzedAt || project.lastAnalyzedAt < pending.since)) {
        changedFiles = [...new Set([...changedFiles, ...pending.files])].sort();
      }
      if (changedFiles.length) pendingChanges[relativePath] = { files: changedFiles, since: newlyChanged ? checkedAt : pending?.since ?? checkedAt };
      const uncertain = inventory.issues.some(issue => issue === '.' || related(issue) || relativePath.startsWith(`${issue}/`));
      let status: WorkspaceEntry['status'] = uncertain ? 'unknown' : changedFiles.length ? 'changed' : projectId ? 'managed' : 'new';
      if (!current.has(relativePath)) {
        status = 'unknown';
        try {
          const stat = fs.lstatSync(absolute);
          if (!stat.isDirectory() || stat.isSymbolicLink()) status = 'unavailable';
          else if (comparable && inventory.directories.includes(relativePath) && !uncertain) status = 'changed';
        } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) status = 'unavailable';
        }
      }
      entries.push({ relativePath, projectId, status, changedFiles: uncertain ? [] : changedFiles });
    }
    const complete = inventory.issues.length === 0;
    const record: StoredWorkspace = { rootPath: input.rootPath, maxDepth: input.maxDepth, excludeDirs,
      ignoredPaths: input.ignoredPaths ?? old?.ignoredPaths ?? [], checkedAt, pendingChanges,
      lastSuccessAt: complete ? new Date().toISOString() : old?.lastSuccessAt, entries, issues: inventory.issues,
      baseline: complete ? inventory : old?.baseline, baselineRules: complete ? rules : old?.baselineRules,
      candidates: [...allPaths].slice(0, 1000) };
    this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(keyFor(input.rootPath), JSON.stringify(record));
  }
}
