import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { FailurePolicy, RunProfile, ServiceConfig, ServiceEnvVar, ServiceType } from '@codehelm/domain';
import { generateId } from '@codehelm/shared';

interface RunProfileRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  is_default: number;
  failure_policy: string;
  user_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ServiceConfigRow {
  id: string;
  run_profile_id: string;
  name: string;
  type: string;
  module_relative_path: string;
  executable: string;
  args_json: string;
  cwd_relative: string;
  env_json: string;
  port: number | null;
  port_extract_regex: string | null;
  health_check_json: string | null;
  depends_on_json: string;
  enabled: number;
  source: string;
  start_timeout_ms: number | null;
  stop_timeout_ms: number | null;
}

export class ProfileRepository {
  constructor(private db: DatabaseInstance) {}

  save(profile: {
    id?: string;
    projectId: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    failurePolicy: FailurePolicy;
    services: ServiceConfig[];
    userConfirmedAt?: string;
  }): RunProfile {
    const id = profile.id ?? generateId();
    const now = new Date().toISOString();

    const saveTransaction = this.db.transaction(() => {
      // Upsert profile
      const stmtProfile = this.db.prepare(`
        INSERT INTO run_profiles (id, project_id, name, description, is_default, failure_policy, user_confirmed_at, created_at, updated_at)
        VALUES (@id, @project_id, @name, @description, @is_default, @failure_policy, @user_confirmed_at, @created_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          is_default = excluded.is_default,
          failure_policy = excluded.failure_policy,
          user_confirmed_at = excluded.user_confirmed_at,
          updated_at = excluded.updated_at
      `);

      stmtProfile.run({
        id,
        project_id: profile.projectId,
        name: profile.name,
        description: profile.description ?? null,
        is_default: profile.isDefault ? 1 : 0,
        failure_policy: profile.failurePolicy,
        user_confirmed_at: profile.userConfirmedAt ?? null,
        created_at: now,
        updated_at: now,
      });

      // Clear existing services for this profile
      this.db.prepare('DELETE FROM service_configs WHERE run_profile_id = ?').run(id);

      // Insert services
      const stmtService = this.db.prepare(`
        INSERT INTO service_configs (
          id, run_profile_id, name, type, module_relative_path, executable, args_json,
          cwd_relative, env_json, port, port_extract_regex, health_check_json,
          depends_on_json, enabled, source, start_timeout_ms, stop_timeout_ms
        ) VALUES (
          @id, @run_profile_id, @name, @type, @module_relative_path, @executable, @args_json,
          @cwd_relative, @env_json, @port, @port_extract_regex, @health_check_json,
          @depends_on_json, @enabled, @source, @start_timeout_ms, @stop_timeout_ms
        )
      `);

      for (const s of profile.services) {
        const sId = s.id || generateId();
        stmtService.run({
          id: sId,
          run_profile_id: id,
          name: s.name,
          type: s.type,
          module_relative_path: s.moduleRelativePath,
          executable: s.executable,
          args_json: JSON.stringify(s.args),
          cwd_relative: s.cwdRelative,
          env_json: JSON.stringify(s.env),
          port: s.port ?? null,
          port_extract_regex: s.portExtractRegex ?? null,
          health_check_json: s.healthCheck ? JSON.stringify(s.healthCheck) : null,
          depends_on_json: JSON.stringify(s.dependsOn),
          enabled: s.enabled ? 1 : 0,
          source: s.source,
          start_timeout_ms: s.startTimeoutMs ?? null,
          stop_timeout_ms: s.stopTimeoutMs ?? null,
        });
      }
    });

    saveTransaction();
    return this.findById(id)!;
  }

  findById(id: string): RunProfile | null {
    const stmt = this.db.prepare('SELECT * FROM run_profiles WHERE id = ?');
    const row = stmt.get(id) as RunProfileRow | undefined;
    if (!row) return null;

    const services = this.findServicesByProfileId(id);
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      isDefault: Boolean(row.is_default),
      failurePolicy: row.failure_policy as FailurePolicy,
      services,
      userConfirmedAt: row.user_confirmed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  findByProjectId(projectId: string): RunProfile[] {
    const stmt = this.db.prepare('SELECT id FROM run_profiles WHERE project_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(projectId) as { id: string }[];
    return rows.map((r) => this.findById(r.id)!).filter(Boolean);
  }

  private findServicesByProfileId(profileId: string): ServiceConfig[] {
    const stmt = this.db.prepare('SELECT * FROM service_configs WHERE run_profile_id = ?');
    const rows = stmt.all(profileId) as ServiceConfigRow[];

    return rows.map((r) => ({
      id: r.id,
      runProfileId: r.run_profile_id,
      name: r.name,
      type: r.type as ServiceType,
      moduleRelativePath: r.module_relative_path,
      executable: r.executable,
      args: JSON.parse(r.args_json || '[]'),
      cwdRelative: r.cwd_relative,
      env: JSON.parse(r.env_json || '[]') as ServiceEnvVar[],
      port: r.port ?? undefined,
      portExtractRegex: r.port_extract_regex ?? undefined,
      healthCheck: r.health_check_json ? JSON.parse(r.health_check_json) : undefined,
      dependsOn: JSON.parse(r.depends_on_json || '[]'),
      enabled: Boolean(r.enabled),
      source: r.source as 'detected' | 'manual',
      startTimeoutMs: r.start_timeout_ms ?? undefined,
      stopTimeoutMs: r.stop_timeout_ms ?? undefined,
    }));
  }
}
