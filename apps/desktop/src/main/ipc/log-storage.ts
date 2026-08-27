import { LogRotator } from '@codehelm/runner';
import type { LogBatch } from '@codehelm/domain';
import type { AppSettingsDto, LogStorageStatusDto } from '@codehelm/contracts';

const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_ENTRIES = 10000;

export class LogStorage {
  private readonly rotator: LogRotator;
  private tail: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private pendingBytes = 0;
  private pendingEntries = 0;
  private droppedEntries = 0;
  private lastError: string | null = null;
  private stats = { fileCount: 0, totalBytes: 0 };
  private maintenancePending = false;
  private closed = false;
  private bytesSinceMaintenance = 0;

  constructor(readonly directory: string, private readSettings: () => AppSettingsDto) {
    this.rotator = new LogRotator(directory);
  }

  start(): void {
    if (this.timer || this.closed) return;
    void this.maintain().catch(() => undefined);
    this.timer = setInterval(() => { void this.maintain().catch(() => undefined); }, 60000);
    this.timer.unref();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch((error) => {
      this.lastError = error instanceof Error ? error.message : '日志存储操作失败';
      console.error('[LogStorage]', this.lastError);
    });
    return result;
  }

  accept(batch: LogBatch): void {
    if (batch.entries.length === 0 || this.closed) return;
    const bytes = Buffer.byteLength(JSON.stringify(batch));
    if (this.pendingBytes + bytes > MAX_PENDING_BYTES || this.pendingEntries + batch.entries.length > MAX_PENDING_ENTRIES) {
      this.droppedEntries += batch.entries.length;
      this.lastError = '日志写盘队列已满，部分日志未保存。请减少服务输出或检查磁盘。';
      return;
    }
    this.pendingBytes += bytes;
    this.pendingEntries += batch.entries.length;
    // Snapshot: listeners/renderer cannot mutate the queued content.
    const entries = batch.entries.map((entry) => ({ ...entry }));
    void this.enqueue(async () => {
      try {
        await this.rotator.appendBatch(batch.projectId, entries, batch.runSessionId);
        this.bytesSinceMaintenance += bytes;
        if (this.bytesSinceMaintenance >= 4 * 1024 * 1024) await this.applyPolicy();
      } catch (error) {
        // A partially written batch is counted conservatively as not guaranteed durable.
        this.droppedEntries += entries.length;
        throw error;
      } finally {
        this.pendingBytes -= bytes;
        this.pendingEntries -= entries.length;
      }
    }).catch(() => undefined);
  }

  async maintain(): Promise<void> {
    if (this.maintenancePending || this.closed) return;
    this.maintenancePending = true;
    try {
      await this.enqueue(async () => {
        await this.applyPolicy();
      });
    } finally { this.maintenancePending = false; }
  }

  private async applyPolicy(): Promise<void> {
    const settings = this.readSettings();
    await this.rotator.cleanup(settings.maxLogRetentionDays, settings.maxLogRetentionMb);
    this.stats = await this.rotator.getStats();
    this.bytesSinceMaintenance = 0;
  }

  clear() {
    return this.enqueue(async () => {
      const result = await this.rotator.clearAll();
      this.stats = await this.rotator.getStats();
      return result;
    });
  }

  async getStatus(): Promise<LogStorageStatusDto> {
    await this.getDirectoryForOpen().catch(() => undefined);
    return {
      available: true, directory: this.directory, ...this.stats,
      pendingBytes: this.pendingBytes, droppedEntries: this.droppedEntries, lastError: this.lastError,
    };
  }

  async getDirectoryForOpen(): Promise<string> {
    // Unlike the status read, an open request must not swallow initialization errors.
    await this.enqueue(async () => { this.stats = await this.rotator.getStats(); });
    return this.directory;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.closed = true;
    await this.tail;
  }
}
