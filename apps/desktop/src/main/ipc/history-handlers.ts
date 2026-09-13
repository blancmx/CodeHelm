import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { SessionRepository } from '@codehelm/database';
import { HistoryQuerySchema, StoredLogQuerySchema, RunSessionDtoSchema, IpcChannels, type StoredLogPage } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import type { LogStorage } from './log-storage.js';
import { getAppSettings } from './app-settings.js';
import { createAnalysisBoundaryFromWorker } from './analysis-tasks.js';
import type { LogReadPosition, LogReadResult } from './stored-log-reader.js';

export function registerHistoryHandlers(handle: RegisterIpcHandler, db: Database, logs: LogStorage) {
  const sessions = new SessionRepository(db);
  const cursors = new Map<string, { owner: number; fingerprint: string; position: LogReadPosition; expires: number }>();
  const busy = new Set<number>();
  handle(IpcChannels.HISTORY_QUERY, (_event, raw) => {
    const result = sessions.query(HistoryQuerySchema.parse(raw));
    return { ...result, sessions: result.sessions.map(session => RunSessionDtoSchema.parse(session)) };
  });
  const readLogs = async (event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<StoredLogPage> => {
    const query = StoredLogQuerySchema.parse(raw), run = sessions.findById(query.runSessionId,1);
    if (!run) throw new Error('运行记录不存在。');
    if (query.serviceSessionId && !db.prepare('SELECT 1 FROM service_sessions WHERE id=? AND run_session_id=?').get(query.serviceSessionId,run.id)) throw new Error('服务不属于此会话。');
    if (busy.has(event.sender.id) || busy.size >= 2) throw new Error('日志查询正在进行，请稍后重试。');
    const fingerprint = JSON.stringify({ ...query, cursor: undefined });
    const saved = query.cursor ? cursors.get(query.cursor) : undefined;
    if (query.cursor && (!saved || saved.owner !== event.sender.id || saved.fingerprint !== fingerprint || saved.expires < Date.now())) throw new Error('日志分页已过期或筛选已改变，请重新查询。');
    if (query.cursor) cursors.delete(query.cursor);
    for (const [key,value] of cursors) if (value.expires < Date.now()) cursors.delete(key);
    busy.add(event.sender.id);
    const controller = new AbortController(), cancel = () => controller.abort();
    event.sender.once('destroyed', cancel); event.sender.on('did-start-navigation', cancel);
    const timer = setTimeout(cancel, 8_000);
    let worker: Worker | undefined;
    let boundary: ReturnType<typeof createAnalysisBoundaryFromWorker> | undefined;
    try {
      const directory = await logs.prepareRead();
      boundary = createAnalysisBoundaryFromWorker(new Worker(path.join(__dirname,'analysis-boundary-worker.js'),{workerData:{rootPath:directory,maxEntries:4096,sharedLogRead:true}}));
      const rootSessionId = await boundary.ready;
      controller.signal.throwIfAborted();
      worker = new Worker(path.join(__dirname, 'history-log-worker.js'), { workerData: { directory, rootSessionId, projectId: run.projectId, query, position: saved?.position }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      const result = await new Promise<LogReadResult>((resolve,reject) => {
        const abort = () => reject(new Error('日志查询已取消或超时，请缩小范围后重试。'));
        controller.signal.addEventListener('abort',abort,{ once: true });
        worker!.once('message', message => { controller.signal.removeEventListener('abort',abort); if (message.error) reject(new Error(message.error)); else resolve(message.result); });
        worker!.once('error',reject);
        worker!.once('exit',code => { if (code !== 0) reject(new Error('日志查询工作进程已结束。')); });
      });
      controller.signal.throwIfAborted();
      let nextCursor: string | undefined;
      if (result.position) {
        while (cursors.size >= 20) cursors.delete(cursors.keys().next().value!);
        nextCursor = randomBytes(32).toString('hex');
        cursors.set(nextCursor, { owner: event.sender.id, fingerprint, position: result.position, expires: Date.now()+5*60_000 });
      }
      const settings = getAppSettings(db), status = logs.getReadCounters();
      const timestamps = result.entries.map(entry => entry.timestamp).sort();
      return { entries: result.entries, nextCursor, snapshotAt: result.snapshotAt, scannedBytes: result.scannedBytes, skippedRecords: result.skippedRecords,
        missingFiles: result.missingFiles, truncatedEntries: result.truncatedEntries, fileLimitReached: result.fileLimitReached,
        retentionDays: settings.maxLogRetentionDays, retentionMb: settings.maxLogRetentionMb, droppedEntries: status.droppedEntries,
        storageError: status.lastError ?? undefined,
        firstTimestamp: timestamps[0], lastTimestamp: timestamps.at(-1) };
    } finally {
      clearTimeout(timer);
      try { await worker?.terminate(); }
      finally {
        try { await boundary?.close(); }
        finally {
          busy.delete(event.sender.id);
          event.sender.removeListener('destroyed',cancel); event.sender.removeListener('did-start-navigation',cancel);
        }
      }
    }
  };
  handle(IpcChannels.HISTORY_LOGS, readLogs);
  return readLogs;
}
