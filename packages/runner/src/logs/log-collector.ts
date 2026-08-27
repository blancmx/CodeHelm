import {
  DEFAULT_MAX_LOG_BATCH_BYTES,
  DEFAULT_MAX_LOG_BUFFER_BYTES,
  DEFAULT_MAX_LOG_BUFFER_ENTRIES,
  DEFAULT_MAX_LOG_ENTRY_BYTES,
  truncateUtf8,
  utf8ByteLength,
} from '@codehelm/domain';
import type { LogBatch, LogEntry, LogStreamType } from '@codehelm/domain';
import { generateId } from '@codehelm/shared';

export type LogListener = (batch: LogBatch) => void;

interface PendingBatch {
  projectId: string;
  entries: LogEntry[];
  bytes: number;
}

interface RingOrderEntry {
  serviceSessionId: string;
  entryId: string;
  bytes: number;
}

export class LogCollector {
  private buffers = new Map<string, LogEntry[]>(); // serviceSessionId -> entries
  private bufferBytes = new Map<string, number>();
  private ringOrder: RingOrderEntry[] = [];
  private totalBufferedBytes = 0;
  private pendingBatches = new Map<string, PendingBatch>(); // runSessionId -> batch
  private pendingBytes = 0;
  private pendingEntryCount = 0;
  private listeners = new Set<LogListener>();
  private flushTimer: NodeJS.Timeout | null = null;
  private maxRingBufferSize: number;
  private maxRingBufferBytes: number;
  private maxPendingBatchBytes: number;
  private maxEntryBytes: number;

  constructor(
    maxRingBufferSize: number = DEFAULT_MAX_LOG_BUFFER_ENTRIES,
    maxRingBufferBytes: number = DEFAULT_MAX_LOG_BUFFER_BYTES,
    maxPendingBatchBytes: number = DEFAULT_MAX_LOG_BATCH_BYTES
  ) {
    for (const [name, value] of [
      ['ring entry', maxRingBufferSize],
      ['ring byte', maxRingBufferBytes],
      ['pending batch byte', maxPendingBatchBytes],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid ${name} limit`);
      }
    }
    this.maxRingBufferSize = maxRingBufferSize;
    this.maxRingBufferBytes = maxRingBufferBytes;
    this.maxPendingBatchBytes = maxPendingBatchBytes;
    this.maxEntryBytes = Math.min(DEFAULT_MAX_LOG_ENTRY_BYTES, maxPendingBatchBytes);
  }

  append(
    projectId: string,
    runSessionId: string,
    serviceSessionId: string,
    serviceName: string,
    stream: LogStreamType,
    message: string
  ): LogEntry {
    const boundedMessage = truncateUtf8(message, this.maxEntryBytes);
    const entry: LogEntry = {
      id: generateId(),
      serviceSessionId,
      serviceName,
      stream,
      message: boundedMessage,
      timestamp: new Date().toISOString(),
    };
    const entryBytes = utf8ByteLength(boundedMessage);

    // 1. Append to ring buffer
    let buffer = this.buffers.get(serviceSessionId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(serviceSessionId, buffer);
    }
    buffer.push(entry);
    const nextBufferBytes = (this.bufferBytes.get(serviceSessionId) ?? 0) + entryBytes;
    this.bufferBytes.set(serviceSessionId, nextBufferBytes);
    this.ringOrder.push({ serviceSessionId, entryId: entry.id, bytes: entryBytes });
    this.totalBufferedBytes += entryBytes;
    while (
      buffer.length > this.maxRingBufferSize
      || (this.bufferBytes.get(serviceSessionId) ?? 0) > this.maxRingBufferBytes
      || this.ringOrder.length > this.maxRingBufferSize
      || this.totalBufferedBytes > this.maxRingBufferBytes
    ) {
      if (!this.evictOldest()) break;
    }

    // 2. Add to pending flush batch
    let pending = this.pendingBatches.get(runSessionId);
    if (
      this.pendingEntryCount >= this.maxRingBufferSize
      || (this.pendingBytes > 0 && this.pendingBytes + entryBytes > this.maxPendingBatchBytes)
    ) {
      this.flush();
      pending = undefined;
    }
    if (!pending) {
      pending = { projectId, entries: [], bytes: 0 };
      this.pendingBatches.set(runSessionId, pending);
    }
    pending.entries.push(entry);
    pending.bytes += entryBytes;
    this.pendingBytes += entryBytes;
    this.pendingEntryCount += 1;

    this.scheduleFlush();
    return entry;
  }

  getLogs(serviceSessionId: string): LogEntry[] {
    return this.buffers.get(serviceSessionId) || [];
  }

  clearLogs(serviceSessionId: string): void {
    const bytes = this.bufferBytes.get(serviceSessionId) ?? 0;
    this.buffers.delete(serviceSessionId);
    this.bufferBytes.delete(serviceSessionId);
    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - bytes);
    this.ringOrder = this.ringOrder.filter((item) => item.serviceSessionId !== serviceSessionId);
  }

  onBatch(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 50);
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pendingBatches.size === 0) return;

    const batches = this.pendingBatches;
    this.pendingBatches = new Map();
    this.pendingBytes = 0;
    this.pendingEntryCount = 0;

    for (const [runSessionId, data] of batches.entries()) {
      if (data.entries.length === 0) continue;

      const batch: LogBatch = {
        projectId: data.projectId,
        runSessionId,
        entries: [...data.entries],
      };

      for (const listener of this.listeners) {
        try {
          listener(batch);
        } catch (err) {
          console.error('Log listener error:', err);
        }
      }
    }

  }

  private evictOldest(): boolean {
    const oldest = this.ringOrder.shift();
    if (!oldest) return false;

    const buffer = this.buffers.get(oldest.serviceSessionId);
    if (!buffer) return true;
    const index = buffer.findIndex((entry) => entry.id === oldest.entryId);
    if (index < 0) return true;

    buffer.splice(index, 1);
    const nextBytes = Math.max(0, (this.bufferBytes.get(oldest.serviceSessionId) ?? 0) - oldest.bytes);
    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - oldest.bytes);
    if (buffer.length === 0) {
      this.buffers.delete(oldest.serviceSessionId);
      this.bufferBytes.delete(oldest.serviceSessionId);
    } else {
      this.bufferBytes.set(oldest.serviceSessionId, nextBytes);
    }
    return true;
  }
}
