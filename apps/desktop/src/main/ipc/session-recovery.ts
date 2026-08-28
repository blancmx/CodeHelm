import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceSession } from '@codehelm/domain';
import type { SessionRepository } from '@codehelm/database';
import { ProcessVerifier } from '@codehelm/runner';

const execFileAsync = promisify(execFile);
type RecoveryOutcome = NonNullable<ServiceSession['recovery']>['outcome'];

async function readStartTime(pid: number): Promise<number | undefined> {
  let observed: number | undefined;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()`],
      { timeout: 1500, windowsHide: true, maxBuffer: 1024 });
      const parsed = Number(stdout.trim());
      if (Number.isSafeInteger(parsed) && parsed > 0) observed = parsed;
    } else {
      observed = ProcessVerifier.getProcessStartTime(pid);
    }
  } catch { /* Permission denied, timeout and process exit must never imply ownership. */ }
  return observed;
}

export async function inspectHistoricalService(
  service: ServiceSession, readCreationTime: (pid: number) => Promise<number | undefined> = readStartTime,
): Promise<RecoveryOutcome> {
  const { pid, fingerprint } = service;
  // No recorded PID may mean a crash between spawn and recording the child. Do not invent an exit.
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return 'unverified';
  if (!ProcessVerifier.isPidAlive(pid)) return 'not-running';
  if (!fingerprint || fingerprint.pid !== pid || fingerprint.identityVerified !== true
    || !Number.isSafeInteger(fingerprint.startTime)) return 'unverified';
  let observed: number | undefined;
  try { observed = await readCreationTime(pid); } catch { return 'unverified'; }
  if (!ProcessVerifier.isPidAlive(pid)) return 'not-running';
  if (observed === undefined) return 'unverified';
  return observed === fingerprint.startTime ? 'identity-match' : 'pid-reused';
}

/** Read-only OS inspection. No historical child is adopted, signalled, restarted or auto-killed. */
export async function recoverInterruptedSessions(
  repository: SessionRepository,
  inspect: (service: ServiceSession) => Promise<RecoveryOutcome> = inspectHistoricalService,
): Promise<number> {
  const sessions = repository.listUnfinished();
  for (const session of sessions) {
    for (const service of session.services) {
      if (!['STARTING','RUNNING','STOPPING','DEGRADED','VERIFYING','ORPHANED'].includes(service.status)) continue;
      let outcome: RecoveryOutcome;
      try { outcome = await inspect(service); } catch { outcome = 'unverified'; }
      service.recovery = { outcome, checkedAt: new Date().toISOString() };
      service.status = outcome === 'not-running' || outcome === 'pid-reused' ? 'STOPPED' : 'ORPHANED';
      // Actual process exit time is unknown. Keep the old timestamp if any; never use check time as exit time.
    }
    session.status = 'INTERRUPTED';
    repository.save(session);
  }
  return sessions.length;
}
