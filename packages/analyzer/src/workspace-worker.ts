import { parentPort, workerData } from 'node:worker_threads';
import { WorkspaceScanner } from './discovery/workspace-scanner.js';

if (!parentPort) throw new Error('Workspace worker requires a parent port');
const port = parentPort;
let lastSent = 0;
let latest = { type: 'progress', scannedDirectories: 0, foundProjects: 0 };
void new WorkspaceScanner().scan(workerData.rootPath, {
  rootSessionId: workerData.rootSessionId,
  maxDepth: workerData.maxDepth,
  onProgress(scannedDirectories, foundProjects) {
    latest = { type: 'progress', scannedDirectories, foundProjects };
    if (Date.now() - lastSent < 100) return;
    lastSent = Date.now();
    port.postMessage(latest);
  },
}).then((discovered) => {
  port.postMessage({ ...latest, foundProjects: discovered.length });
  port.postMessage({ type: 'result', discovered });
  port.close();
}).catch((error: unknown) => {
  port.postMessage({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
  port.close();
});
