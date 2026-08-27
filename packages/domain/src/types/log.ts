export type LogStreamType = 'stdout' | 'stderr' | 'system';

export const DEFAULT_MAX_LOG_ENTRY_BYTES = 64 * 1024;
export const DEFAULT_MAX_LOG_BUFFER_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_LOG_BATCH_BYTES = 256 * 1024;
export const DEFAULT_MAX_LOG_BUFFER_ENTRIES = 5000;
export const LOG_TRUNCATION_MARKER = '\n[日志已截断]\n';

function utf8CodePointBytes(value: string): number {
  const codePoint = value.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    bytes += utf8CodePointBytes(character);
  }
  return bytes;
}

/** Keep a log message within a raw UTF-8 byte limit without splitting a code point. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid log byte limit');
  }
  if (utf8ByteLength(value) <= maxBytes) return value;

  const markerBytes = utf8ByteLength(LOG_TRUNCATION_MARKER);
  const contentLimit = maxBytes > markerBytes ? maxBytes - markerBytes : maxBytes;
  let bytes = 0;
  let offset = 0;
  for (const character of value) {
    const characterBytes = utf8CodePointBytes(character);
    if (bytes + characterBytes > contentLimit) {
      return value.slice(0, offset) + (maxBytes > markerBytes ? LOG_TRUNCATION_MARKER : '');
    }
    bytes += characterBytes;
    offset += character.length;
  }
  return value;
}

export interface LogEntry {
  id: string;
  serviceSessionId: string;
  serviceName: string;
  stream: LogStreamType;
  message: string;
  timestamp: string;
}

export interface LogBatch {
  projectId: string;
  runSessionId: string;
  entries: LogEntry[];
}
