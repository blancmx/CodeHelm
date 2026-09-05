import { parentPort, workerData } from 'node:worker_threads';
import { AnalyzerEngine } from './engine/analyzer-engine.js';

if (!parentPort) throw new Error('Analysis worker requires a parent port');
const port = parentPort;
const analyzer = new AnalyzerEngine({ maxFiles: workerData.maxFiles, failOnLimit: true, rootSessionId: workerData.rootSessionId });
let lastProgressAt = 0;
let latestProgress = { type: 'progress', percentage: 0, stage: '正在发现项目文件…', scannedFiles: 0 };
void analyzer.analyze(workerData.rootPath, (percentage, stage, scannedFiles) => {
  const now = Date.now();
  latestProgress = { type: 'progress', percentage: Math.min(95, percentage), stage, scannedFiles };
  if (now - lastProgressAt < 100) return;
  lastProgressAt = now;
  port.postMessage(latestProgress);
}).then((snapshot) => {
  // Always flush the final count, including fast scans that fail inside the throttle window.
  port.postMessage(latestProgress);
  port.postMessage({ type: 'result', snapshot });
  port.close();
}).catch((error: unknown) => {
  port.postMessage({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
  port.close();
});
