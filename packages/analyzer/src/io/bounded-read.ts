import fs from 'node:fs/promises';

export const DEFAULT_MAX_ANALYZER_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_ANALYZER_TOTAL_READ_BYTES = 32 * 1024 * 1024;

export class ReadBudget {
  private consumedBytes = 0;
  private reservedBytes = 0;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('Invalid analyzer total read byte limit');
    }
  }

  get remainingBytes(): number {
    return Math.max(0, this.maxBytes - this.consumedBytes - this.reservedBytes);
  }

  consume(bytes: number): void {
    this.assertByteCount(bytes);
    if (bytes > this.remainingBytes) {
      throw new Error('Analyzer total read byte limit exceeded');
    }
    this.consumedBytes += bytes;
  }

  reserve(maxBytes: number): number {
    this.assertByteCount(maxBytes);
    const reservedBytes = Math.min(maxBytes, this.remainingBytes);
    if (reservedBytes <= 0) {
      throw new Error('Analyzer total read byte limit exceeded');
    }
    this.reservedBytes += reservedBytes;
    return reservedBytes;
  }

  commit(reservedBytes: number, consumedBytes: number): void {
    this.assertByteCount(reservedBytes);
    this.assertByteCount(consumedBytes);
    if (consumedBytes > reservedBytes || reservedBytes > this.reservedBytes) {
      throw new Error('Invalid analyzer read budget settlement');
    }
    this.reservedBytes -= reservedBytes;
    this.consumedBytes += consumedBytes;
  }

  release(reservedBytes: number): void {
    this.assertByteCount(reservedBytes);
    if (reservedBytes > this.reservedBytes) {
      throw new Error('Invalid analyzer read budget release');
    }
    this.reservedBytes -= reservedBytes;
  }

  private assertByteCount(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Invalid analyzer byte count');
    }
  }
}

export async function readUtf8FileWithinLimit(
  filePath: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; bytesRead: number }> {
  if (signal?.aborted) throw new Error('Analysis cancelled');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid analyzer file size limit');
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!Number.isSafeInteger(stat.size) || stat.size > maxBytes) {
      throw new Error(`Analyzer file exceeds the ${maxBytes}-byte limit`);
    }

    const buffer = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      if (signal?.aborted) throw new Error('Analysis cancelled');
      const { bytesRead } = await handle.read(buffer, offset, stat.size - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    return {
      text: buffer.subarray(0, offset).toString('utf8'),
      bytesRead: offset,
    };
  } finally {
    await handle.close();
  }
}
