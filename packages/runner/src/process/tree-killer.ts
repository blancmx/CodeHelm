import treeKill from 'tree-kill';

export async function killProcessTree(
  pid: number,
  signal: string = 'SIGTERM',
  timeoutMs: number = 3000,
  isStillOwned: () => boolean = () => true,
  canForceKill: () => boolean = isStillOwned,
  isStillRunning: () => boolean = isStillOwned,
  fallbackKill: (signal: string) => void = () => undefined
): Promise<void> {
  if (!pid || pid <= 0) return;

  return new Promise((resolve) => {
    let finished = false;
    let forceSent = false;
    let deadline = Date.now() + Math.max(0, timeoutMs);
    let pollTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearTimeout(pollTimer);
      resolve();
    };

    const schedulePoll = () => {
      if (finished || pollTimer) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        waitForTermination();
      }, 50);
    };

    const waitForTermination = () => {
      if (finished) return;
      if (!isStillRunning()) {
        finish();
        return;
      }

      if (Date.now() < deadline) {
        schedulePoll();
        return;
      }

      if (forceSent || !canForceKill()) {
        finish();
        return;
      }

      forceSent = true;
      deadline = Date.now() + 1000;
      try {
        treeKill(pid, 'SIGKILL', (error) => {
          if (error) {
            try {
              fallbackKill('SIGKILL');
            } catch {
              // The guarded caller remains responsible for reporting an
              // unkillable process as orphaned.
            }
          }
          waitForTermination();
        });
        schedulePoll();
      } catch {
        try {
          fallbackKill('SIGKILL');
        } catch {
          // The guarded caller remains responsible for reporting an
          // unkillable process as orphaned.
        }
        finish();
      }
    };

    try {
      if (!isStillOwned()) {
        finish();
        return;
      }
      treeKill(pid, signal, (error) => {
        if (error) {
          try {
            fallbackKill(signal);
          } catch {
            // The guarded caller remains responsible for reporting an
            // unkillable process as orphaned.
          }
        }
        // tree-kill's callback means the signal was dispatched, not that the
        // process tree has exited. Keep polling so stubborn children reach the
        // guarded force-kill path instead of becoming silent orphans.
        waitForTermination();
      });
      schedulePoll();
    } catch {
      try {
        fallbackKill(signal);
      } catch {
        // The guarded caller remains responsible for reporting an unkillable
        // process as orphaned.
      }
      waitForTermination();
    }
  });
}
