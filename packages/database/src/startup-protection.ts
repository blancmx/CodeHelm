import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, DATABASE_SCHEMA_VERSION } from './db.js';

const CORE_TABLES = ['projects', 'run_profiles', 'service_configs', 'app_settings'] as const;
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
export type BackupReason = 'before-startup' | 'legacy-import' | 'first-startup' | 'periodic';

export interface DatabaseBackupPolicy {
  intervalMs: number;
  maxBackups: number;
  maxTotalBytes: number;
  minRetainedBackups: number;
  minFreeBytes: number;
}

export const DEFAULT_DATABASE_BACKUP_POLICY: Readonly<DatabaseBackupPolicy> = Object.freeze({
  intervalMs: 30 * 60 * 1_000,
  maxBackups: 20,
  maxTotalBytes: 2 * GIBIBYTE,
  minRetainedBackups: 3,
  minFreeBytes: 256 * MEBIBYTE,
});

export class DatabaseBackupCapacityError extends Error {
  readonly code = 'INSUFFICIENT_BACKUP_SPACE';

  constructor(
    public readonly requiredBytes: bigint,
    public readonly availableBytes: bigint,
    public readonly reservedBytes: bigint,
  ) {
    super(`数据库备份空间不足：至少需要 ${requiredBytes} 字节，可用 ${availableBytes} 字节（其中 ${reservedBytes} 字节为安全余量）。`);
    this.name = 'DatabaseBackupCapacityError';
  }
}

export interface DatabaseBackupMaintenanceResult {
  removedDirectories: string[];
  retainedBackups: number;
  retainedBytes: number;
  skippedDirectories: string[];
  limitsSatisfied: boolean;
}

export interface VerifiedDatabaseBackup {
  databasePath: string;
  manifestPath: string;
  sha256: string;
  counts: Record<string, number>;
  maintenance: DatabaseBackupMaintenanceResult;
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

function resolveBackupPolicy(policy: Partial<DatabaseBackupPolicy> = {}): DatabaseBackupPolicy {
  const resolved = { ...DEFAULT_DATABASE_BACKUP_POLICY, ...policy };
  const integerFields: Array<keyof DatabaseBackupPolicy> = [
    'intervalMs', 'maxBackups', 'maxTotalBytes', 'minRetainedBackups', 'minFreeBytes',
  ];
  for (const field of integerFields) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] < 1) {
      throw new Error(`数据库备份策略 ${field} 必须是正安全整数。`);
    }
  }
  if (resolved.minRetainedBackups > resolved.maxBackups) {
    throw new Error('数据库备份策略 minRetainedBackups 不能大于 maxBackups。');
  }
  return resolved;
}

async function defaultAvailableBytes(directory: string): Promise<bigint> {
  const stat = await fs.promises.statfs(directory);
  return BigInt(stat.bavail) * BigInt(stat.bsize);
}

interface VerifiedBackupEntry {
  directoryPath: string;
  databasePath: string;
  manifestPath: string;
  createdAtMs: number;
  bytes: number;
  sha256: string;
}

function readVerifiedBackupEntry(directoryPath: string): VerifiedBackupEntry | undefined {
  const directoryStat = fs.lstatSync(directoryPath);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return undefined;
  const names = fs.readdirSync(directoryPath).sort();
  if (names.length !== 2 || names[0] !== 'codehelm.sqlite' || names[1] !== 'manifest.json') return undefined;
  const databasePath = path.join(directoryPath, 'codehelm.sqlite');
  const manifestPath = path.join(directoryPath, 'manifest.json');
  const databaseStat = fs.lstatSync(databasePath);
  const manifestStat = fs.lstatSync(manifestPath);
  if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const createdAtMs = typeof manifest.createdAt === 'string' ? Date.parse(manifest.createdAt) : Number.NaN;
  if (manifest.formatVersion !== 1 || manifest.status !== 'verified' || manifest.databaseFile !== 'codehelm.sqlite'
    || manifest.bytes !== databaseStat.size || typeof manifest.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(manifest.sha256) || !Number.isFinite(createdAtMs)) return undefined;
  return {
    directoryPath, databasePath, manifestPath, createdAtMs,
    bytes: databaseStat.size, sha256: manifest.sha256.toLowerCase(),
  };
}

async function maintainVerifiedBackups(
  backupDirectory: string,
  policy: DatabaseBackupPolicy,
  protectedDirectory: string,
): Promise<DatabaseBackupMaintenanceResult> {
  const verified: VerifiedBackupEntry[] = [];
  const skippedDirectories: string[] = [];
  for (const name of fs.readdirSync(backupDirectory).sort()) {
    if (name.startsWith('.pending-')) {
      skippedDirectories.push(name);
      continue;
    }
    const entryPath = path.join(backupDirectory, name);
    try {
      const entry = readVerifiedBackupEntry(entryPath);
      if (entry) verified.push(entry);
      else skippedDirectories.push(name);
    } catch {
      skippedDirectories.push(name);
    }
  }

  verified.sort((left, right) => right.createdAtMs - left.createdAtMs
    || right.directoryPath.localeCompare(left.directoryPath));
  let retainedBytes = verified.reduce((total, entry) => total + entry.bytes, 0);
  let retainedBackups = verified.length;
  const removedDirectories: string[] = [];
  for (const entry of [...verified].reverse()) {
    if (retainedBackups <= policy.minRetainedBackups) break;
    if (retainedBackups <= policy.maxBackups && retainedBytes <= policy.maxTotalBytes) break;
    if (path.resolve(entry.directoryPath) === path.resolve(protectedDirectory)) continue;
    if (await hashFile(entry.databasePath) !== entry.sha256) {
      skippedDirectories.push(path.basename(entry.directoryPath));
      retainedBackups -= 1;
      retainedBytes -= entry.bytes;
      continue;
    }
    fs.unlinkSync(entry.databasePath);
    fs.unlinkSync(entry.manifestPath);
    fs.rmdirSync(entry.directoryPath);
    removedDirectories.push(entry.directoryPath);
    retainedBackups -= 1;
    retainedBytes -= entry.bytes;
  }
  return {
    removedDirectories,
    retainedBackups,
    retainedBytes,
    skippedDirectories,
    limitsSatisfied: retainedBackups <= policy.maxBackups && retainedBytes <= policy.maxTotalBytes,
  };
}

export interface CreateVerifiedDatabaseBackupOptions {
  source: DatabaseInstance;
  sourcePath: string;
  backupDirectory: string;
  reason: BackupReason;
  policy?: Partial<DatabaseBackupPolicy>;
  getAvailableBytes?: (directory: string) => Promise<bigint>;
}

/** Publishes only complete, checked snapshots; pending artifacts are never restore candidates. */
export async function createVerifiedDatabaseBackup(
  options: CreateVerifiedDatabaseBackupOptions,
): Promise<VerifiedDatabaseBackup> {
  const { source, reason } = options;
  const sourcePath = path.resolve(options.sourcePath);
  const backupDirectory = path.resolve(options.backupDirectory);
  const policy = resolveBackupPolicy(options.policy);
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const walBytes = fileStat(`${sourcePath}-wal`)?.size ?? 0;
  const sourceBytes = BigInt(fs.statSync(sourcePath).size + walBytes);
  const workBytes = sourceBytes * 2n > BigInt(64 * MEBIBYTE) ? sourceBytes * 2n : BigInt(64 * MEBIBYTE);
  const reservedBytes = BigInt(policy.minFreeBytes);
  const requiredBytes = workBytes + reservedBytes;
  const availableBytes = await (options.getAvailableBytes ?? defaultAvailableBytes)(backupDirectory);
  if (availableBytes < requiredBytes) {
    throw new DatabaseBackupCapacityError(requiredBytes, availableBytes, reservedBytes);
  }
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
  const maintenance = await maintainVerifiedBackups(backupDirectory, policy, finalDirectory);
  return {
    databasePath: path.join(finalDirectory, 'codehelm.sqlite'),
    manifestPath: path.join(finalDirectory, 'manifest.json'), sha256, counts, maintenance,
  };
}

export interface PeriodicDatabaseBackupController {
  runNow(): Promise<VerifiedDatabaseBackup | undefined>;
  stop(): Promise<void>;
}

export interface PeriodicDatabaseBackupOptions extends Omit<CreateVerifiedDatabaseBackupOptions, 'reason'> {
  onSuccess?: (backup: VerifiedDatabaseBackup) => void;
  onError?: (error: unknown) => void;
}

export function startPeriodicDatabaseBackups(options: PeriodicDatabaseBackupOptions): PeriodicDatabaseBackupController {
  const policy = resolveBackupPolicy(options.policy);
  let stopped = false;
  let active: Promise<VerifiedDatabaseBackup | undefined> | undefined;
  const runNow = (): Promise<VerifiedDatabaseBackup | undefined> => {
    if (stopped) return Promise.resolve(undefined);
    if (active) return active;
    active = createVerifiedDatabaseBackup({ ...options, policy, reason: 'periodic' })
      .then((backup) => {
        options.onSuccess?.(backup);
        return backup;
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        return undefined;
      })
      .finally(() => { active = undefined; });
    return active;
  };
  const timer = setInterval(() => { void runNow(); }, policy.intervalMs);
  timer.unref();
  return {
    runNow,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}

export interface ProtectedDatabaseOptions {
  databasePath: string;
  backupDirectory?: string;
  legacyDatabasePath?: string;
  backupPolicy?: Partial<DatabaseBackupPolicy>;
  getAvailableBytes?: (directory: string) => Promise<bigint>;
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
      backup = await createVerifiedDatabaseBackup({
        source, sourcePath, backupDirectory,
        reason: importedLegacy ? 'legacy-import' : 'before-startup',
        policy: options.backupPolicy,
        getAvailableBytes: options.getAvailableBytes,
      });
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
      backup = await createVerifiedDatabaseBackup({
        source: db, sourcePath: databasePath, backupDirectory, reason: 'first-startup',
        policy: options.backupPolicy,
        getAvailableBytes: options.getAvailableBytes,
      });
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
