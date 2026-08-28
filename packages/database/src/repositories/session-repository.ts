import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { RunSession, ServiceSession } from '@codehelm/domain';

type Row = Record<string, any>;

export class SessionRepository {
  constructor(private db: DatabaseInstance) {}

  /** One transaction per lifecycle snapshot; never store environment or command arguments. */
  save(session: RunSession): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO run_sessions (id,project_id,run_profile_id,status,started_at,stopped_at)
        VALUES (@id,@projectId,@runProfileId,@status,@startedAt,@stoppedAt)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, stopped_at=excluded.stopped_at`)
        .run({ ...session, stoppedAt: session.stoppedAt ?? null });
      const saveService = this.db.prepare(`INSERT INTO service_sessions
        (id,run_session_id,service_config_id,service_name,service_type,status,pid,fingerprint_json,
         recovery_json,port,exit_code,exit_signal,error_message,started_at,stopped_at)
        VALUES (@id,@runSessionId,@serviceConfigId,@serviceName,@serviceType,@status,@pid,@fingerprint,
          @recovery,@port,@exitCode,@exitSignal,@errorMessage,@startedAt,@stoppedAt)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,pid=excluded.pid,
          fingerprint_json=excluded.fingerprint_json,recovery_json=excluded.recovery_json,
          port=excluded.port,exit_code=excluded.exit_code,exit_signal=excluded.exit_signal,
          error_message=excluded.error_message,stopped_at=excluded.stopped_at`);
      for (const service of session.services) {
        const fingerprint = service.fingerprint ? { ...service.fingerprint, argsSummary: '' } : undefined;
        saveService.run({
          ...service, fingerprint: fingerprint ? JSON.stringify(fingerprint) : null,
          recovery: service.recovery ? JSON.stringify(service.recovery) : null,
          pid: service.pid ?? null, port: service.port ?? null,
          exitCode: service.exitCode ?? null, exitSignal: service.exitSignal ?? null,
          errorMessage: service.errorMessage ?? null,
          startedAt: service.startedAt ?? null, stoppedAt: service.stoppedAt ?? null,
        });
      }
      // Replaced service IDs (restart) remain as completed history in this run.
    })();
  }

  findById(id: string): RunSession | undefined {
    const row = this.db.prepare('SELECT * FROM run_sessions WHERE id = ?').get(id) as Row | undefined;
    if (!row) return undefined;
    const services = this.db.prepare('SELECT * FROM service_sessions WHERE run_session_id = ? ORDER BY started_at,id').all(id) as Row[];
    return {
      id: row.id, projectId: row.project_id, runProfileId: row.run_profile_id,
      status: row.status, startedAt: row.started_at, stoppedAt: row.stopped_at ?? undefined,
      services: services.map((s): ServiceSession => ({
        id: s.id, runSessionId: s.run_session_id, serviceConfigId: s.service_config_id,
        serviceName: s.service_name, serviceType: s.service_type, status: s.status,
        pid: s.pid ?? undefined, port: s.port ?? undefined,
        fingerprint: s.fingerprint_json ? JSON.parse(s.fingerprint_json) : undefined,
        recovery: s.recovery_json ? JSON.parse(s.recovery_json) : undefined,
        exitCode: s.exit_code ?? undefined, exitSignal: s.exit_signal ?? undefined,
        errorMessage: s.error_message ?? undefined,
        startedAt: s.started_at ?? undefined, stoppedAt: s.stopped_at ?? undefined,
      })),
    };
  }

  listRecent(limit = 50): RunSession[] {
    const rows = this.db.prepare('SELECT id FROM run_sessions ORDER BY started_at DESC,id DESC LIMIT ?')
      .all(Math.max(1, Math.min(100, Math.trunc(limit)))) as { id: string }[];
    return rows.map(({ id }) => this.findById(id)!);
  }

  listUnfinished(): RunSession[] {
    const rows = this.db.prepare(`SELECT id FROM run_sessions WHERE status IN ('STARTING','RUNNING','STOPPING','PARTIAL_FAILED')
      OR id IN (SELECT run_session_id FROM service_sessions WHERE status IN ('STARTING','RUNNING','STOPPING','DEGRADED','VERIFYING','ORPHANED'))`).all() as { id: string }[];
    return rows.map(({ id }) => this.findById(id)!);
  }

  hasUnresolvedProfile(profileId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM service_sessions s JOIN run_sessions r ON r.id=s.run_session_id
      WHERE r.run_profile_id=? AND s.status='ORPHANED' LIMIT 1`).get(profileId);
  }

  /** All blocked records, independent of the recent-history limit; never a live-control source. */
  listUnresolved(): RunSession[] {
    const rows = this.db.prepare(`SELECT id FROM run_sessions
      WHERE id IN (SELECT run_session_id FROM service_sessions WHERE status='ORPHANED')
      ORDER BY started_at DESC,id DESC`).all() as { id: string }[];
    return rows.map(({ id }) => this.findById(id)!);
  }
}
