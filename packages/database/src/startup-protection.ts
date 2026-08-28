import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, DATABASE_SCHEMA_VERSION } from './db.js';

const CORE_TABLES = ['projects', 'run_profiles', 'service_configs', 'app_settings'] as const;
type BackupReason = 'before-startup' | 'legacy-import' | 'first-startup';

export interface VerifiedDatabaseBackup {
  databasePath: string;
  manifestPath: string;
  sha256: string;
  counts: Record<string, number>;
}

export class DatabaseStartupError extends Error {
  constructor(public readonly stage: 'inspect' | 'backup' | 'initialize', message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DatabaseStartupError';
  }
}

function fileStat(file: string): fs.Stats | undefined {
  try { return fs.statSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function verifyDatabase(db: DatabaseInstance): Record<string, number> {
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('数据库完整性检查未通过。');
  }
  if ((db.pragma('foreign_key_check') as unknown[]).length !== 0) {
    throw new Error('数据库外键检查未通过。');
  }
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > DATABASE_SCHEMA_VERSION) {
    throw new Error('数据库版本高于当前应用，请使用更新版本打开。');
  }
  // An empty or unrelated SQLite file is not a new CodeHelm installation.
  return Object.fromEntries(CORE_TABLES.map((table) => [
    table, (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
  ]));
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Publishes only complete, checked snapshots; pending artifacts are never restore candidates. */
async function backupDatabase(
  source: DatabaseInstance, sourcePath: string, backupDirectory: string, reason: BackupReason,
): Promise<VerifiedDatabaseBackup> {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const pendingDirectory = path.join(backupDirectory, `.pending-${id}`);
  const finalDirectory = path.join(backupDirectory, id);
  fs.mkdirSync(pendingDirectory);
  const candidatePath = path.join(pendingDirectory, 'codehelm.sqlite');
  const startedAt = performance.now();
  // SQLite's backup API includes committed WAL pages; copying the main file does not.
  await source.backup(candidatePath, {
    progress: () => {
      if (performance.now() - startedAt > 60_000) throw new Error('数据库备份超时，请关闭其他数据库写入工具后重试。');
      return 100;
    },
  });
  const candidate = new Database(candidatePath, { fileMustExist: true });
  let counts: Record<string, number>;
  let schemaVersion: number;
  try {
    // Make each published backup a standalone file, without WAL/SHM dependencies.
    candidate.pragma('journal_mode = DELETE');
    counts = verifyDatabase(candidate);
    schemaVersion = candidate.pragma('user_version', { simple: true }) as number;
  } finally { candidate.close(); }
  const handle = await fs.promises.open(candidatePath, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  const sha256 = await hashFile(candidatePath);
  const manifestPath = path.join(pendingDirectory, 'manifest.json');
  const manifest = await fs.promises.open(manifestPath, 'wx');
  try {
    await manifest.writeFile(JSON.stringify({
      formatVersion: 1, status: 'verified', createdAt, reason, sourcePath,
      databaseFile: 'codehelm.sqlite', bytes: fs.statSync(candidatePath).size,
      sha256, schemaVersion, integrityCheck: 'ok', foreignKeyViolations: 0, counts,
    }, null, 2) + '\n');
    await manifest.sync();
  } finally { await manifest.close(); }
  fs.renameSync(pendingDirectory, finalDirectory);
  return {
    databasePath: path.join(finalDirectory, 'codehelm.sqlite'),
    manifestPath: path.join(finalDirectory, 'manifest.json'), sha256, counts,
  };
}

export interface ProtectedDatabaseOptions {
  databasePath: string;
  backupDirectory?: string;
  legacyDatabasePath?: string;
}

/** Must finish before registering any writable IPC handlers. Never repairs/replaces an existing file. */
export async function openProtectedDatabase(options: ProtectedDatabaseOptions): Promise<{
  db: DatabaseInstance;
  backup: VerifiedDatabaseBackup;
  importedLegacy: boolean;
}> {
  const databasePath = path.resolve(options.databasePath);
  const backupDirectory = path.resolve(options.backupDirectory ?? path.join(path.dirname(databasePath), 'backups'));
  let stage: DatabaseStartupError['stage'] = 'inspect';
  let source: DatabaseInstance | undefined;
  let db: DatabaseInstance | undefined;
  try {
    const existing = fileStat(databasePath);
    let sourcePath: string | undefined = existing ? databasePath : undefined;
    if (!existing) {
      // Do not silently turn a disappeared database (or an interrupted copy) into an empty library.
      const orphan = ['-wal', '-shm', '-journal'].some((suffix) => fileStat(databasePath + suffix));
      const backups = fileStat(backupDirectory);
      if (orphan || (backups && fs.readdirSync(backupDirectory).length > 0)) {
        throw new Error('主数据库缺失，但发现日志侧文件或已有备份。请保留文件并人工核对，应用不会创建空库。');
      }
      if (options.legacyDatabasePath && fileStat(options.legacyDatabasePath)) {
        sourcePath = path.resolve(options.legacyDatabasePath);
      }
    }
    let backup: VerifiedDatabaseBackup;
    const importedLegacy = !!sourcePath && sourcePath !== databasePath;
    if (sourcePath) {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile() || stat.size === 0) throw new Error('数据库不是有效的非空文件，请保留原文件排查。');
      source = new Database(sourcePath, { readonly: true, fileMustExist: true });
      verifyDatabase(source);
      stage = 'backup';
      backup = await backupDatabase(source, sourcePath, backupDirectory, importedLegacy ? 'legacy-import' : 'before-startup');
      source.close();
      source = undefined;
      stage = 'initialize';
      if (importedLegacy) {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        // Copy only the verified standalone snapshot, never a live legacy main file.
        fs.copyFileSync(backup.databasePath, databasePath, fs.constants.COPYFILE_EXCL);
      }
      db = createDatabase(databasePath, { fileMustExist: true });
    } else {
      stage = 'initialize';
      // Reserve the new path exclusively: a concurrently appearing file must not be initialized.
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.closeSync(fs.openSync(databasePath, 'wx'));
      db = createDatabase(databasePath, { fileMustExist: true });
      stage = 'backup';
      backup = await backupDatabase(db, databasePath, backupDirectory, 'first-startup');
    }
    return { db, backup, importedLegacy };
  } catch (cause) {
    db?.close();
    const messages = {
      inspect: '数据库安全检查未通过，已停止启动。不会自动重建、修复或覆盖原库。',
      backup: '无法完成经校验的数据库备份，已停止启动。请检查备份目录权限、磁盘空间及数据库占用。',
      initialize: '数据库初始化或升级失败，已停止启动。请保留原库和备份，不要删除文件重试。',
    };
    throw new DatabaseStartupError(stage, messages[stage], cause);
  } finally { source?.close(); }
}
