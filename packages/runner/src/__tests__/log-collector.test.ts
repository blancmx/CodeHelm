import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_LOG_BATCH_BYTES,
  DEFAULT_MAX_LOG_BUFFER_BYTES,
  DEFAULT_MAX_LOG_ENTRY_BYTES,
  truncateUtf8,
  utf8ByteLength,
} from '@codehelm/domain';
import { LogCollector } from '../logs/log-collector.js';

function append(collector: LogCollector, serviceSessionId: string, message: string) {
  return collector.append('project', 'run', serviceSessionId, serviceSessionId, 'stdout', message);
}

describe('LogCollector byte bounds', () => {
  it('truncates one oversized UTF-8 message without splitting its byte limit', () => {
    const message = '界'.repeat(DEFAULT_MAX_LOG_ENTRY_BYTES);
    const entry = append(new LogCollector(), 'service', message);

    expect(utf8ByteLength(entry.message)).toBeLessThanOrEqual(DEFAULT_MAX_LOG_ENTRY_BYTES);
    expect(entry.message).toContain('日志已截断');
  });

  it('bounds the shared in-memory ring by bytes and entries', () => {
    const collector = new LogCollector(2, 10, DEFAULT_MAX_LOG_BATCH_BYTES);

    append(collector, 'first', '123456');
    append(collector, 'second', 'abcdef');

    expect(collector.getLogs('first')).toEqual([]);
    expect(collector.getLogs('second').map((entry) => entry.message)).toEqual(['abcdef']);
  });

  it('flushes pending batches before they exceed their byte bound', () => {
    const batches: string[][] = [];
    const collector = new LogCollector(5000, DEFAULT_MAX_LOG_BUFFER_BYTES, 100);
    collector.onBatch((batch) => batches.push(batch.entries.map((entry) => entry.message)));

    append(collector, 'service', 'a'.repeat(60));
    append(collector, 'service', 'b'.repeat(60));

    expect(batches).toEqual([['a'.repeat(60)]]);
  });

  it('keeps UTF-8 truncation output within very small limits', () => {
    for (const limit of [1, 2, 3, 4]) {
      expect(utf8ByteLength(truncateUtf8('你好', limit))).toBeLessThanOrEqual(limit);
    }
  });
});
