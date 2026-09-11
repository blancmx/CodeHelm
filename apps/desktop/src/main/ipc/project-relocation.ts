import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProfileRepository, ProjectRepository, SessionRepository } from '@codehelm/database';
import type { RelocationPreview } from '@codehelm/contracts';
import { normalizePath } from '@codehelm/shared';
import { isExecutionInputInside, withExecutionReadBudget } from './execution-input-reader.js';

const manifests = ['package.json', 'pnpm-workspace.yaml', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml', 'index.html', 'README.md'];
const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A preview never binds by directory name. Commit rechecks physical identity and reviewed inputs. */
export class ProjectRelocation {
  private previews = new Map<string, { id: string; fingerprint: string; preview: RelocationPreview; expires: number }>();
  private projects: ProjectRepository;
  private profiles: ProfileRepository;
  constructor(private db: DatabaseInstance, private assertIdle: (profileId: string) => void = () => {}, private invalidateApproval: (profileId: string) => void = () => {}) {
    this.projects = new ProjectRepository(db);
    this.profiles = new ProfileRepository(db);
  }

  private configuration(id: string) {
    const project = this.projects.findById(id);
    if (!project) throw new Error('项目已移除，请刷新列表。');
    const profiles = this.profiles.findByProjectId(id);
    for (const profile of profiles) this.assertIdle(profile.id);
    if (new SessionRepository(this.db).listUnfinished().some(run => run.projectId === id)) {
      throw new Error('项目仍有运行或未解决的进程记录，请先停止运行并处理恢复记录。');
    }
    return { project, profiles };
  }

  private async inspect(id: string, rootPath: string) {
    if (!path.isAbsolute(rootPath)) throw new Error('请选择绝对目录路径。');
    return withExecutionReadBudget(async budget => {
      const configuration = this.configuration(id);
      const stat = await fs.lstat(rootPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('新位置必须是普通目录，不能直接绑定目录链接。');
      const physical = await fs.realpath(rootPath);
      const newPath = normalizePath(physical);
      for (const project of this.projects.list()) {
        if (project.id === id) continue;
        let other = project.rootPath;
        try { other = await fs.realpath(other); }
        catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        budget.check();
        if (key(normalizePath(other)) === key(newPath)) throw new Error('此目录已被其他项目纳管，不能重复绑定。');
      }
      const directories = new Set(['.']);
      for (const profile of configuration.profiles) for (const service of profile.services) {
        directories.add(service.cwdRelative || '.');
        directories.add(service.moduleRelativePath || '.');
      }
      const files: RelocationPreview['manifests'] = [];
      for (const relative of [...directories].sort()) {
        budget.candidate();
        const absolute = path.resolve(physical, relative);
        if (path.isAbsolute(relative) || !isExecutionInputInside(physical, absolute)) throw new Error(`配置目录越界：${relative}`);
        const real = await fs.realpath(absolute);
        if (!isExecutionInputInside(physical, real) || !(await fs.stat(real)).isDirectory()) throw new Error(`配置目录不可用或链接越界：${relative}`);
        for (const name of manifests) {
          budget.candidate();
          const file = path.join(real, name);
          const resolved = await budget.physical(file);
          if (!isExecutionInputInside(physical, resolved)) throw new Error(`清单链接越界：${relative}/${name}`);
          const hash = await budget.hash(file);
          if (hash !== 'missing' && hash !== 'directory') files.push({ path: path.relative(physical, file).replace(/\\/g, '/'), sha256: hash });
        }
      }
      if (!files.length) throw new Error('未找到可核对的项目清单或 README，请确认选择了正确的项目根目录。');
      budget.check();
      const preview = { oldPath: configuration.project.rootPath, newPath, manifests: files, directories: [...directories].sort() };
      return { preview, fingerprint: digest({ configuration, preview, identity: [stat.dev, stat.ino] }), configuration: digest(configuration) };
    });
  }

  async preview(id: string, rootPath: string): Promise<RelocationPreview> {
    const result = await this.inspect(id, rootPath);
    for (const [token, entry] of this.previews) if (entry.id === id || entry.expires < Date.now()) this.previews.delete(token);
    if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
    const token = randomUUID();
    const preview = { token, ...result.preview };
    this.previews.set(token, { id, fingerprint: result.fingerprint, preview, expires: Date.now() + 5 * 60_000 });
    return preview;
  }

  async commit(id: string, token: string) {
    const entry = this.previews.get(token);
    this.previews.delete(token);
    if (!entry || entry.id !== id || entry.expires < Date.now()) throw new Error('路径确认已过期，请重新核对。');
    const checked = await this.inspect(id, entry.preview.newPath);
    if (checked.fingerprint !== entry.fingerprint) throw new Error('目录、清单或配置已变化，请重新核对后确认。');
    this.db.transaction(() => {
      if (digest(this.configuration(id)) !== checked.configuration) throw new Error('项目配置已变化，请重新核对。');
      const prior = this.profiles.findByProjectId(id).map(p => Date.parse(p.updatedAt) || 0);
      const now = new Date(Math.max(Date.now(), ...prior.map(time => time + 1))).toISOString();
      this.db.prepare('UPDATE projects SET root_path=?,real_path_hash=NULL,last_analyzed_at=NULL,updated_at=? WHERE id=?').run(entry.preview.newPath, now, id);
      this.db.prepare('UPDATE run_profiles SET user_confirmed_at=NULL,updated_at=? WHERE project_id=?').run(now, id);
    })();
    for (const profile of this.profiles.findByProjectId(id)) this.invalidateApproval(profile.id);
    return this.projects.findById(id)!;
  }
}
