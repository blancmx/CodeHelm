import { parentPort, workerData } from 'node:worker_threads';
import { closeRoot, openRoot } from '@codehelm/safe-fs';

if (!parentPort) throw new Error('Analysis boundary worker requires a parent port');
const port = parentPort;

let sessionId: string | undefined;
try {
  sessionId = openRoot(String(workerData.rootPath), Number(workerData.maxEntries));
  port.postMessage({ type: 'ready', sessionId });
} catch (error) {
  port.postMessage({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
  port.close();
}

port.on('message', (message: unknown) => {
  if (!sessionId || typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'close') return;
  try {
    closeRoot(sessionId);
    sessionId = undefined;
    port.postMessage({ type: 'closed' });
  } catch (error) {
    port.postMessage({ type: 'close-error', errorMessage: error instanceof Error ? error.message : String(error) });
  } finally {
    port.close();
  }
});
