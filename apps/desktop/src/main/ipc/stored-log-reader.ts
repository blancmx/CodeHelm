import fs from 'node:fs/promises';
import path from 'node:path';
import { readFile } from '@codehelm/safe-fs';
import { LogEntryDtoSchema, type StoredLogQuery, type LogEntryDto } from '@codehelm/contracts';
import { LOG_TRUNCATION_MARKER } from '@codehelm/domain';

interface FileSnapshot { name: string; size: number; ino: number; dev: number }
export interface LogReadPosition { files: FileSnapshot[]; file: number; line: number; snapshotAt: string; fileLimitReached: boolean }
export interface LogReadResult {
  entries: LogEntryDto[]; position?: LogReadPosition; snapshotAt: string; fileLimitReached: boolean;
  scannedBytes: number; skippedRecords: number; missingFiles: number; truncatedEntries: number;
}
export interface LogReadInput { directory: string; projectId: string; rootSessionId: string; query: StoredLogQuery; position?: LogReadPosition }

/** Runs in a disposable worker. Reads only native-bound files, never supplied paths. */
export async function readStoredLogPage(input: LogReadInput): Promise<LogReadResult> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.projectId)) throw new Error('无效项目标识');
  const projectDirectory = path.join(input.directory, input.projectId);
  let state = input.position;
  let missingFiles = 0;
  if (!state) {
    const files: FileSnapshot[] = [];
    let fileLimitReached = false;
    try {
      const dir = await fs.opendir(projectDirectory);
      let count = 0;
      for await (const entry of dir) {
        if (++count > 512) { fileLimitReached = true; break; }
        if (!entry.name.endsWith('.log')) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) { missingFiles++; continue; }
        const stat = await fs.lstat(path.join(projectDirectory, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) { missingFiles++; continue; }
        files.push({ name: entry.name, size: stat.size, ino: stat.ino, dev: stat.dev });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    state = { files: files.sort((a,b) => a.name.localeCompare(b.name)), file: 0, line: 0, snapshotAt: new Date().toISOString(), fileLimitReached };
  }
  const result: LogReadResult = { entries: [], snapshotAt: state.snapshotAt, fileLimitReached: state.fileLimitReached,
    scannedBytes: 0, skippedRecords: 0, missingFiles, truncatedEntries: 0 };
  let outputBytes = 0;
  outer: while (state.file < state.files.length && result.scannedBytes < 32 * 1024 * 1024) {
    const file = state.files[state.file];
    let data: Buffer;
    try {
      const stat = await fs.lstat(path.join(projectDirectory, file.name));
      if (stat.size < file.size || stat.ino !== file.ino || stat.dev !== file.dev) throw new Error('文件已替换或截断');
      const remainingBytes = 32 * 1024 * 1024 - result.scannedBytes;
      if (stat.size <= 16 * 1024 * 1024 && stat.size > remainingBytes) break;
      data = readFile(input.rootSessionId, `${input.projectId}/${file.name}`, Math.min(16 * 1024 * 1024, remainingBytes));
      result.scannedBytes += data.length;
      data = data.subarray(0,file.size);
    } catch { result.missingFiles++; state.file++; state.line=0; continue; }
    const lines = data.toString('utf8').split('\n');
    // The last incomplete line may still be in flight; do not parse it as a complete record.
    if (lines.at(-1)) result.skippedRecords++;
    lines.pop();
    while (state.line < lines.length) {
      const line = lines[state.line];
      let entry: LogEntryDto;
      try {
        const raw = JSON.parse(line);
        if (raw.runSessionId !== input.query.runSessionId) { state.line++; continue; }
        entry = LogEntryDtoSchema.parse(raw);
        if (!Number.isFinite(Date.parse(entry.timestamp)) || entry.serviceName.length > 500 || entry.id.length > 128 || entry.serviceSessionId.length > 128) throw new Error('Invalid record');
      } catch { result.skippedRecords++; state.line++; continue; }
      const query = input.query;
      if ((query.serviceSessionId && query.serviceSessionId !== entry.serviceSessionId)
        || (query.stream && query.stream !== entry.stream)
        || (query.keyword && !entry.message.toLowerCase().includes(query.keyword.toLowerCase()))
        || (query.from && Date.parse(entry.timestamp) < Date.parse(query.from))
        || (query.to && Date.parse(entry.timestamp) > Date.parse(query.to))) { state.line++; continue; }
      const bytes = Buffer.byteLength(JSON.stringify(entry));
      if (bytes > 1024 * 1024) { result.skippedRecords++; state.line++; continue; }
      if (result.entries.length >= 200 || outputBytes + bytes > 1024 * 1024) break outer;
      outputBytes += bytes; result.entries.push(entry); state.line++;
      if (entry.message.includes(LOG_TRUNCATION_MARKER)) result.truncatedEntries++;
    }
    state.file++; state.line=0;
  }
  if (state.file < state.files.length) result.position = state;
  return result;
}
