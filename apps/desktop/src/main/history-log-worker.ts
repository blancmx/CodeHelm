import { parentPort, workerData } from 'node:worker_threads';
import { readStoredLogPage } from './ipc/stored-log-reader.js';
readStoredLogPage(workerData).then(result => parentPort?.postMessage({ result }), () => parentPort?.postMessage({ error: '日志读取失败；文件可能已被清理、替换或无法访问。' }));
