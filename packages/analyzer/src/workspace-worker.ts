import { parentPort, workerData } from 'node:worker_threads';
import { workspaceInventory } from './discovery/workspace-inventory.js';
import { WorkspaceScanner } from './discovery/workspace-scanner.js';

if (!parentPort) throw new Error('Workspace worker requires a parent port');
const port = parentPort;
const directories: string[] = [];
const issues: string[] = [];
let lastSent = 0;
let latest = { type: 'progress', scannedDirectories: 0, foundProjects: 0 };
void new WorkspaceScanner().scan(workerData.rootPath, {
  rootSessionId: workerData.rootSessionId,
  maxDepth: workerData.maxDepth,
  excludeDirs: workerData.excludeDirs,
  onDirectory: relative => directories.push(relative),
  onIssue: relative => issues.push(relative),
  onProgress(scannedDirectories, foundProjects) {
    latest = { type: 'progress', scannedDirectories, foundProjects };
    if (Date.now() - lastSent < 100) return;
    lastSent = Date.now();
    port.postMessage(latest);
  },
}).then((discovered) => {
  port.postMessage({ ...latest, foundProjects: discovered.length });
  const inventory = workerData.remember && workerData.rootSessionId ? workspaceInventory(workerData.rootSessionId, directories, issues) : undefined;
  port.postMessage({ type: 'result', discovered, inventory });
  port.close();
}).catch((error: unknown) => {
  port.postMessage({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
  port.close();
});
