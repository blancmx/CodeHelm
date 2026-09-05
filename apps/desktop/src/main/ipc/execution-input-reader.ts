import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const EXECUTION_READ_LIMITS: Readonly<Record<'fileBytes' | 'totalBytes' | 'candidates' | 'timeoutMs', number>> = Object.freeze({
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  candidates: 512,
  timeoutMs: 10_000,
});
const CHUNK_BYTES = 64 * 1024;
let activeReads = 0;

export interface ExecutionReadOptions {
  signal?: AbortSignal;
  // Internal callers/tests may tighten, never raise, the production limits.
  limits?: Partial<typeof EXECUTION_READ_LIMITS>;
}

function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

export function isExecutionInputInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export class ExecutionReadBudget {
  readonly limits: typeof EXECUTION_READ_LIMITS;
  private candidates = 0;
  private consumed = 0;

  constructor(readonly signal: AbortSignal, limits: ExecutionReadOptions['limits']) {
    this.limits = { ...EXECUTION_READ_LIMITS, ...limits };
    for (const key of Object.keys(EXECUTION_READ_LIMITS) as Array<keyof typeof EXECUTION_READ_LIMITS>) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] <= 0
        || this.limits[key] > EXECUTION_READ_LIMITS[key]) throw new Error('Invalid execution read limit');
    }
  }

  check(): void { this.signal.throwIfAborted(); }

  candidate(): void {
    this.check();
    if (++this.candidates > this.limits.candidates) throw new Error('执行输入候选数量超限，请缩小启动方案。');
  }

  checkSize(size: number): void {
    this.check();
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.fileBytes) {
      throw new Error('执行输入单文件大小超限，无法安全确认。');
    }
    if (size > this.limits.totalBytes - this.consumed) throw new Error('执行输入累计读取大小超限，无法安全确认。');
  }

  // Resolve missing tails like shared.safeResolvePath, without synchronous I/O.
  async physical(file: string): Promise<string> {
    const tail: string[] = [];
    let current = file;
    while (true) {
      this.check();
      try {
        const resolved = await fs.realpath(current);
        this.check();
        return path.resolve(resolved, ...tail.reverse());
      } catch (error) {
        if (!missing(error)) throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        tail.push(path.basename(current));
        current = parent;
      }
    }
  }

  async hash(file: string): Promise<string> {
    const hash = createHash('sha256');
    const marker = await this.read(file, chunk => hash.update(chunk));
    return marker ?? hash.digest('hex');
  }

  async text(file: string): Promise<string> {
    const chunks: Buffer[] = [];
    const marker = await this.read(file, chunk => { chunks.push(Buffer.from(chunk)); });
    if (marker) throw new Error('运行配置扫描输入已缺失或不是普通文件，请重新确认。');
    return Buffer.concat(chunks).toString('utf8');
  }

  private async read(file: string, consume: (chunk: Buffer) => void): Promise<'missing' | 'directory' | undefined> {
    this.check();
    let before;
    try { before = await fs.stat(file); }
    catch (error) { if (missing(error)) { this.check(); return 'missing'; } throw error; }
    this.check();
    // Directory arguments (npm --prefix ./web, node ./dist) are legitimate.
    // As before, their contents are not recursively fingerprinted.
    if (before.isDirectory()) return 'directory';
    this.checkSize(before.size);
    if (!before.isFile()) throw new Error('执行输入不是普通文件，无法安全确认。');
    const handle = await fs.open(file, 'r');
    try {
      this.check();
      const opened = await handle.stat();
      this.checkSize(opened.size);
      if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino
        || before.size !== opened.size || before.mtimeMs !== opened.mtimeMs) {
        throw new Error('执行输入读取期间发生变化，请重新确认。');
      }
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let offset = 0;
      while (offset < opened.size) {
        this.check();
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
        this.check();
        if (bytesRead === 0) throw new Error('执行输入读取期间发生变化，请重新确认。');
        this.checkSize(bytesRead);
        this.consumed += bytesRead;
        offset += bytesRead;
        consume(buffer.subarray(0, bytesRead));
      }
      // Detect growth without reading the newly appended payload.
      const after = await handle.stat();
      this.check();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        throw new Error('执行输入读取期间发生变化，请重新确认。');
      }
      return undefined;
    } finally { await handle.close(); }
  }
}

export async function withExecutionReadBudget<T>(
  work: (budget: ExecutionReadBudget) => Promise<T>,
  options: ExecutionReadOptions = {}
): Promise<T> {
  options.signal?.throwIfAborted();
  if (activeReads >= 2) throw new Error('执行输入校验忙，请稍后重试。');
  const controller = new AbortController();
  const budget = new ExecutionReadBudget(controller.signal, options.limits);
  const cancel = () => controller.abort(new Error('执行输入校验已取消。'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('执行输入校验超时，请缩小启动方案后重试。')), budget.limits.timeoutMs);
  let onAbort: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  activeReads++;
  // A pending OS read cannot be forcibly cancelled. Keep its concurrency slot
  // until it settles and closes; timeout/cancel still returns promptly to IPC.
  const reading = Promise.resolve().then(() => work(budget)).finally(() => { activeReads--; });
  try { return await Promise.race([reading, aborted]); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort!);
  }
}
