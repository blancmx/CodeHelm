import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ProcessFingerprint, ProcessStatus } from '@codehelm/domain';

export class ProcessVerifier {
  /**
   * Checks if a process with the given PID is currently alive on the system.
   */
  static isPidAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;

    try {
      // Sending signal 0 performs error checking without actually killing the process
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // EPERM means process exists but we lack permission, ESRCH means process does not exist
      return err.code === 'EPERM';
    }
  }

  /**
   * Verifies whether a historical process record safely matches a currently running process.
   * Prevents mistakenly killing an unrelated new process that happened to reuse the same PID.
   */
  static verifyHistoricalProcess(
    pid?: number,
    fingerprint?: ProcessFingerprint
  ): ProcessStatus {
    if (!pid) return 'STOPPED';

    const alive = this.isPidAlive(pid);
    if (!alive) {
      return 'STOPPED';
    }

    if (!fingerprint || fingerprint.pid !== pid) {
      // Alive, but we have no fingerprint to safely prove it is our process
      return 'ORPHANED';
    }

    // A historical PID is safe to use only when the platform can corroborate
    // the recorded process creation time. If that check is unavailable, fail
    // closed instead of treating the PID as owned.
    return this.isFingerprintCurrent(pid, fingerprint) === true ? 'RUNNING' : 'ORPHANED';
  }

  /**
   * Active ChildProcess state is the strongest identity signal available to
   * this in-memory manager. Once the child has exited, its PID must never be
   * sent to a tree killer because the OS may have reused it.
   */
  static isActiveChildProcess(pid: number, child?: ChildProcess): boolean {
    return Boolean(
      child
      && child.pid === pid
      && child.exitCode === null
      && child.signalCode === null
      && this.isPidAlive(pid)
    );
  }

  /** Return false only when the OS proves a different creation time. */
  static isFingerprintCurrent(
    pid: number,
    fingerprint?: ProcessFingerprint
  ): boolean | undefined {
    if (!fingerprint || fingerprint.pid !== pid || !Number.isSafeInteger(fingerprint.startTime)) {
      return false;
    }
    if (fingerprint.identityVerified === false) return undefined;

    const currentStartTime = this.getProcessStartTime(pid);
    if (currentStartTime === undefined) return undefined;
    return currentStartTime === fingerprint.startTime;
  }

  /** Best-effort OS process creation time lookup with fixed, non-shell commands. */
  static getProcessStartTime(pid: number): number | undefined {
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;

    try {
      if (process.platform === 'win32') {
        const output = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$p = Get-Process -Id ${pid} -ErrorAction Stop; ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()`,
          ],
          {
            encoding: 'utf8',
            timeout: 1000,
            windowsHide: true,
            maxBuffer: 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
          }
        ).trim();
        const value = Number(output);
        return Number.isSafeInteger(value) && value > 0 ? value : undefined;
      }

      if (process.platform === 'linux') {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen < 0) return undefined;
        const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
        const startTicks = Number(fields[19]);
        const bootLine = fs.readFileSync('/proc/stat', 'utf8')
          .split('\n')
          .find((line) => line.startsWith('btime '));
        const bootSeconds = Number(bootLine?.split(/\s+/)[1]);
        const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], {
          encoding: 'utf8',
          timeout: 1000,
          maxBuffer: 1024,
        }).trim());
        if (
          !Number.isFinite(startTicks)
          || !Number.isFinite(bootSeconds)
          || !Number.isFinite(ticksPerSecond)
          || ticksPerSecond <= 0
        ) {
          return undefined;
        }
        const value = Math.round((bootSeconds + startTicks / ticksPerSecond) * 1000);
        return Number.isSafeInteger(value) && value > 0 ? value : undefined;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}
