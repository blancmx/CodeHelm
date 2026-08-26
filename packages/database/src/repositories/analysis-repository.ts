import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { AnalysisSnapshot, AnalysisStatus, DetectedTechnology, LanguageStat, ProjectModule } from '@codehelm/domain';
import { generateId } from '@codehelm/shared';

interface SnapshotRow {
  id: string;
  project_id: string;
  analyzer_version: string;
  status: string;
  primary_language: string;
  languages_json: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface ModuleRow {
  id: string;
  snapshot_id: string;
  name: string;
  relative_path: string;
  module_type: string;
  technologies_json: string;
  suggested_commands_json: string;
}

export class AnalysisRepository {
  constructor(private db: DatabaseInstance) {}

  save(snapshot: {
    id?: string;
    projectId: string;
    analyzerVersion: string;
    status: AnalysisStatus;
    primaryLanguage: string;
    languages: LanguageStat[];
    modules: ProjectModule[];
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
  }): AnalysisSnapshot {
    const id = snapshot.id ?? generateId();

    const saveTx = this.db.transaction(() => {
      const stmtSnap = this.db.prepare(`
        INSERT INTO analysis_snapshots (
          id, project_id, analyzer_version, status, primary_language,
          languages_json, started_at, completed_at, error_message
        ) VALUES (
          @id, @project_id, @analyzer_version, @status, @primary_language,
          @languages_json, @started_at, @completed_at, @error_message
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          primary_language = excluded.primary_language,
          languages_json = excluded.languages_json,
          completed_at = excluded.completed_at,
          error_message = excluded.error_message
      `);

      stmtSnap.run({
        id,
        project_id: snapshot.projectId,
        analyzer_version: snapshot.analyzerVersion,
        status: snapshot.status,
        primary_language: snapshot.primaryLanguage,
        languages_json: JSON.stringify(snapshot.languages),
        started_at: snapshot.startedAt,
        completed_at: snapshot.completedAt ?? null,
        error_message: snapshot.errorMessage ?? null,
      });

      // Clear existing modules
      this.db.prepare('DELETE FROM modules WHERE snapshot_id = ?').run(id);

      // Insert modules
      const stmtMod = this.db.prepare(`
        INSERT INTO modules (
          id, snapshot_id, name, relative_path, module_type, technologies_json, suggested_commands_json
        ) VALUES (
          @id, @snapshot_id, @name, @relative_path, @module_type, @technologies_json, @suggested_commands_json
        )
      `);

      for (const m of snapshot.modules) {
        const mId = m.id || generateId();
        stmtMod.run({
          id: mId,
          snapshot_id: id,
          name: m.name,
          relative_path: m.relativePath,
          module_type: m.moduleType,
          technologies_json: JSON.stringify(m.technologies),
          suggested_commands_json: JSON.stringify(m.suggestedCommands ?? []),
        });
      }
    });

    saveTx();
    return this.findById(id)!;
  }

  findById(id: string): AnalysisSnapshot | null {
    const stmt = this.db.prepare('SELECT * FROM analysis_snapshots WHERE id = ?');
    const row = stmt.get(id) as SnapshotRow | undefined;
    if (!row) return null;

    const modules = this.findModulesBySnapshotId(id);
    return {
      id: row.id,
      projectId: row.project_id,
      analyzerVersion: row.analyzer_version,
      status: row.status as AnalysisStatus,
      primaryLanguage: row.primary_language,
      languages: JSON.parse(row.languages_json || '[]') as LanguageStat[],
      modules,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      errorMessage: row.error_message ?? undefined,
    };
  }

  findLatestByProjectId(projectId: string): AnalysisSnapshot | null {
    const stmt = this.db.prepare('SELECT id FROM analysis_snapshots WHERE project_id = ? ORDER BY started_at DESC LIMIT 1');
    const row = stmt.get(projectId) as { id: string } | undefined;
    return row ? this.findById(row.id) : null;
  }

  private findModulesBySnapshotId(snapshotId: string): ProjectModule[] {
    const stmt = this.db.prepare('SELECT * FROM modules WHERE snapshot_id = ?');
    const rows = stmt.all(snapshotId) as ModuleRow[];

    return rows.map((r) => ({
      id: r.id,
      snapshotId: r.snapshot_id,
      name: r.name,
      relativePath: r.relative_path,
      moduleType: r.module_type as any,
      technologies: JSON.parse(r.technologies_json || '[]') as DetectedTechnology[],
      suggestedCommands: JSON.parse(r.suggested_commands_json || '[]'),
    }));
  }
}
