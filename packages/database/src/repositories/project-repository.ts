import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { Project, ProjectSummary } from '@codehelm/domain';
import { generateId, normalizePath } from '@codehelm/shared';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  real_path_hash: string | null;
  description: string | null;
  color: string | null;
  icon: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  last_analyzed_at: string | null;
  last_run_at: string | null;
}

export class ProjectRepository {
  constructor(private db: DatabaseInstance) {}

  create(params: {
    name: string;
    rootPath: string;
    description?: string;
    color?: string;
    icon?: string;
    tags?: string[];
  }): Project {
    const id = generateId();
    const now = new Date().toISOString();
    const normalizedRoot = normalizePath(params.rootPath);
    const tagsJson = JSON.stringify(params.tags ?? []);

    const stmt = this.db.prepare(`
      INSERT INTO projects (
        id, name, root_path, description, color, icon, tags, created_at, updated_at
      ) VALUES (
        @id, @name, @root_path, @description, @color, @icon, @tags, @created_at, @updated_at
      )
    `);

    stmt.run({
      id,
      name: params.name,
      root_path: normalizedRoot,
      description: params.description ?? null,
      color: params.color ?? null,
      icon: params.icon ?? null,
      tags: tagsJson,
      created_at: now,
      updated_at: now,
    });

    return {
      id,
      name: params.name,
      rootPath: normalizedRoot,
      description: params.description,
      color: params.color,
      icon: params.icon,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
  }

  findByRootPath(rootPath: string): Project | null {
    const normalized = normalizePath(rootPath);
    const stmt = this.db.prepare('SELECT * FROM projects WHERE root_path = ?');
    const row = stmt.get(normalized) as ProjectRow | undefined;
    return row ? this.mapRowToProject(row) : null;
  }

  findById(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as ProjectRow | undefined;
    return row ? this.mapRowToProject(row) : null;
  }

  list(): ProjectSummary[] {
    const stmt = this.db.prepare(`
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM modules m JOIN analysis_snapshots a ON m.snapshot_id = a.id WHERE a.project_id = p.id) as module_count,
        (SELECT COUNT(*) FROM service_configs s JOIN run_profiles rp ON s.run_profile_id = rp.id WHERE rp.project_id = p.id) as service_count,
        (SELECT primary_language FROM analysis_snapshots WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as primary_language,
        (SELECT status FROM run_sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as last_run_status
      FROM projects p
      ORDER BY p.updated_at DESC
    `);

    const rows = stmt.all() as (ProjectRow & {
      module_count: number;
      service_count: number;
      primary_language: string | null;
      last_run_status: string | null;
    })[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootPath: r.root_path,
      tags: JSON.parse(r.tags || '[]'),
      color: r.color ?? undefined,
      icon: r.icon ?? undefined,
      primaryLanguages: r.primary_language ? [r.primary_language] : [],
      primaryFrameworks: [],
      moduleCount: r.module_count || 0,
      serviceCount: r.service_count || 0,
      lastRunAt: r.last_run_at ?? undefined,
      lastRunStatus: r.last_run_status ?? undefined,
    }));
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
  }

  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      realPathHash: row.real_path_hash ?? undefined,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAnalyzedAt: row.last_analyzed_at ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
    };
  }
}
