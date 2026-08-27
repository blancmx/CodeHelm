import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_MAX_LOG_ENTRY_BYTES, truncateUtf8, type LogEntry } from '@codehelm/domain';

export const DEFAULT_MAX_LOG_FILE_BYTES = 16 * 1024 * 1024;
export interface LogCleanupResult { deletedCount: number; freedBytes: number }
interface LogFile { path: string; mtimeMs: number; size: number }

export class LogRotator {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly logBaseDir: string;

  constructor(logBaseDir: string, private maxFileBytes = DEFAULT_MAX_LOG_FILE_BYTES) {
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
      throw new Error('Invalid log file byte limit');
    }
    this.logBaseDir = path.resolve(logBaseDir);
  }

  // All file operations share the same queue: no open writer races a rotation or clear.
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe log directory');
  }

  private async fileStat(file: string) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe log file');
    return stat;
  }

  append(projectId: string, serviceName: string, entry: LogEntry): Promise<void> {
    return this.appendBatch(projectId, [{ ...entry, serviceName }]);
  }

  appendBatch(projectId: string, entries: readonly LogEntry[], runSessionId?: string): Promise<void> {
    return this.serialize(async () => {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) throw new Error('Invalid log project identifier');
      await this.ensureDirectory(this.logBaseDir);
      const projectDir = path.join(this.logBaseDir, projectId);
      await this.ensureDirectory(projectDir);
      for (const entry of entries) {
        const date = new Date(entry.timestamp);
        if (!Number.isFinite(date.getTime())) throw new Error('Invalid log timestamp');
        const name = entry.serviceName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'service';
        const hash = createHash('sha256').update(entry.serviceName).digest('hex').slice(0, 8);
        const stem = `${name}-${hash}-${date.toISOString().slice(0, 10)}`;
        // JSON lines preserve stream/session metadata and escape embedded newlines.
        const line = JSON.stringify({ ...entry, runSessionId, message: truncateUtf8(entry.message, DEFAULT_MAX_LOG_ENTRY_BYTES) }) + '\n';
        const bytes = Buffer.byteLength(line);
        if (bytes > this.maxFileBytes) throw new Error('Log entry exceeds the configured file byte limit');
        for (let rotation = 0; ; rotation += 1) {
          const file = path.join(projectDir, `${stem}${rotation ? '-' + rotation : ''}.log`);
          let size = 0;
          try { size = (await this.fileStat(file)).size; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (size + bytes > this.maxFileBytes) continue;
          await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
          break;
        }
      }
    });
  }

  getStats(): Promise<{ fileCount: number; totalBytes: number }> {
    return this.serialize(async () => {
      const files = await this.getAllLogFiles();
      return { fileCount: files.length, totalBytes: files.reduce((sum, f) => sum + f.size, 0) };
    });
  }

  async getTotalLogSizeBytes(): Promise<number> { return (await this.getStats()).totalBytes; }

  cleanup(maxDays = 14, maxTotalMb = 500): Promise<LogCleanupResult> {
    return this.serialize(async () => {
      if (!Number.isFinite(maxDays) || maxDays < 0 || !Number.isFinite(maxTotalMb) || maxTotalMb < 0) {
        throw new Error('Invalid log retention policy');
      }
      const files = (await this.getAllLogFiles()).sort((a, b) => a.mtimeMs - b.mtimeMs);
      let total = files.reduce((sum, f) => sum + f.size, 0);
      const cutoff = Date.now() - maxDays * 86400000;
      const selected = files.filter((file) => {
        if (file.mtimeMs < cutoff || total > maxTotalMb * 1024 * 1024) {
          total -= file.size;
          return true;
        }
        return false;
      });
      return this.removeFiles(selected);
    });
  }

  clearAll(): Promise<LogCleanupResult> {
    return this.serialize(async () => this.removeFiles(await this.getAllLogFiles()));
  }

  private async removeFiles(files: LogFile[]): Promise<LogCleanupResult> {
    const result = { deletedCount: 0, freedBytes: 0 };
    for (const file of files) {
      try {
        await this.ensureDirectory(this.logBaseDir);
        await this.ensureDirectory(path.dirname(file.path));
        const stat = await this.fileStat(file.path);
        await fs.unlink(file.path);
        result.deletedCount += 1;
        result.freedBytes += stat.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        const code = (error as NodeJS.ErrnoException).code || 'IO_ERROR';
        throw new Error(`日志清理未完成：已删除 ${result.deletedCount} 个文件、释放 ${result.freedBytes} 字节；${code}`);
      }
    }
    return result;
  }

  private async getAllLogFiles(): Promise<LogFile[]> {
    await this.ensureDirectory(this.logBaseDir);
    const files: LogFile[] = [];
    // Only our root and one project level are managed; never traverse junctions/symlinks.
    const collect = async (directory: string, projects: boolean): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Unsafe log directory entry');
        if (entry.isDirectory() && projects) {
          await this.ensureDirectory(full);
          await collect(full, false);
        } else if (entry.isFile() && entry.name.endsWith('.log')) {
          try {
            const stat = await this.fileStat(full);
            files.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
    };
    await collect(this.logBaseDir, true);
    return files;
  }
}
