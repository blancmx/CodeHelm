import treeKill from 'tree-kill';

export async function killProcessTree(pid: number, signal: string = 'SIGTERM', timeoutMs: number = 3000): Promise<void> {
  if (!pid || pid <= 0) return;

  return new Promise((resolve) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        // Force kill if graceful stop timed out
        try {
          treeKill(pid, 'SIGKILL', () => {
            finished = true;
            resolve();
          });
        } catch {
          finished = true;
          resolve();
        }
      }
    }, timeoutMs);

    try {
      treeKill(pid, signal, () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve();
        }
      });
    } catch {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve();
      }
    }
  });
}
