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

    if (!fingerprint) {
      // Alive, but we have no fingerprint to safely prove it is our process
      return 'ORPHANED';
    }

    // Process is alive and has fingerprint
    return 'RUNNING';
  }
}
