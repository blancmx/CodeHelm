import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SCHEMA_SQL } from '../schema.js';
import { DATABASE_SCHEMA_VERSION } from '../db.js';
import { openProtectedDatabase } from '../startup-protection.js';

describe('protected database startup with real SQLite files', () => {
  let root: string;
  let databasePath: string;
  let backupDirectory: string;
  const connections: DatabaseInstance[] = [];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-db-protection-'));
    databasePath = path.join(root, 'codehelm.sqlite');
    backupDirectory = path.join(root, 'backups');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of connections.splice(0)) if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function open(file = databasePath, readonly = false) {
    const db = new Database(file, { readonly });
    connections.push(db);
    return db;
  }
  function seed(file = databasePath, legacy = false) {
    const db = open(file);
    db.exec(legacy ? SCHEMA_SQL.replace("  port_mode TEXT NOT NULL DEFAULT 'auto',\n", '') : SCHEMA_SQL);
    db.exec(`INSERT INTO projects (id,name,root_path,created_at,updated_at)
      VALUES ('p1','保留项目','C:/项目 with spaces','before','before');
      INSERT INTO run_profiles (id,project_id,name,created_at,updated_at)
      VALUES ('r1','p1','原方案','before','before');
      INSERT INTO service_configs (id,run_profile_id,name,type,module_relative_path,executable,cwd_relative,args_json)
      VALUES ('s1','r1','原服务','frontend','.','node','.','["start.js","--port","3017"]');`);
    return db;
  }
  function digest(file = databasePath) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  async function start() {
    const result = await openProtectedDatabase({ databasePath, backupDirectory });
    connections.push(result.db);
    return result;
  }
  function backups() {
    return fs.existsSync(backupDirectory) ? fs.readdirSync(backupDirectory).filter((name) => !name.startsWith('.pending-')) : [];
  }

  it('initializes a new installation and publishes a standalone checked snapshot and hash', async () => {
    const result = await start();
    const manifest = JSON.parse(fs.readFileSync(result.backup.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({ status: 'verified', reason: 'first-startup', schemaVersion: DATABASE_SCHEMA_VERSION,
      integrityCheck: 'ok', foreignKeyViolations: 0, counts: { projects: 0, service_configs: 0 } });
    expect(manifest.sha256).toBe(digest(result.backup.databasePath));
    expect(fs.readdirSync(path.dirname(result.backup.databasePath)).sort()).toEqual(['codehelm.sqlite', 'manifest.json']);
    expect(open(result.backup.databasePath, true).pragma('integrity_check', { simple: true })).toBe('ok');
    expect(result.db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('captures committed data that exists only in WAL, preserving exact profile fields', async () => {
    const writer = seed();
    writer.pragma('journal_mode = WAL');
    writer.pragma('wal_autocheckpoint = 0');
    writer.prepare('UPDATE service_configs SET args_json = ?').run('["--token","private-test-value"]');
    writer.prepare('INSERT INTO app_settings VALUES (?, ?)').run('settings', 'new-in-wal');
    expect(fs.statSync(databasePath + '-wal').size).toBeGreaterThan(0);
    const mainOnly = path.join(root, 'main-only.sqlite');
    fs.copyFileSync(databasePath, mainOnly);
    expect(open(mainOnly, true).prepare('SELECT * FROM app_settings').all()).toEqual([]);
    const expected = writer.prepare('SELECT * FROM service_configs').all();
    const result = await start();
    const snapshot = open(result.backup.databasePath, true);
    expect(snapshot.prepare('SELECT * FROM service_configs').all()).toEqual(expected);
    expect(snapshot.prepare('SELECT value FROM app_settings').pluck().get()).toBe('new-in-wal');
    expect(result.db.prepare('SELECT * FROM service_configs').all()).toEqual(expected);
    expect(fs.readFileSync(result.backup.manifestPath, 'utf8')).not.toContain('private-test-value');
  });

  it('backs up the old schema before migrating, retains previous backups on later startups', async () => {
    seed(databasePath, true).close();
    const first = await start();
    const snapshot = open(first.backup.databasePath, true);
    expect(snapshot.pragma('table_info(service_configs)')).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'port_mode' })]));
    expect(snapshot.pragma('user_version', { simple: true })).toBe(0);
    expect(first.db.prepare('SELECT port_mode FROM service_configs').pluck().get()).toBe('auto');
    first.db.close();
    const originalBackupHash = digest(first.backup.databasePath);
    const second = await start();
    expect(backups()).toHaveLength(2);
    expect(second.backup.databasePath).not.toBe(first.backup.databasePath);
    expect(digest(first.backup.databasePath)).toBe(originalBackupHash);
    expect(second.db.prepare('SELECT name FROM projects').pluck().get()).toBe('保留项目');
  });

  it.each(['not-sqlite', 'truncated', 'zero-length', 'foreign-keys', 'unrelated', 'future-version'])('rejects %s without mutating or replacing the source', async (kind) => {
    if (kind === 'not-sqlite') fs.writeFileSync(databasePath, 'not a SQLite database');
    else if (kind === 'zero-length') fs.writeFileSync(databasePath, '');
    else {
      const db = kind === 'unrelated' ? open() : seed();
      if (kind === 'unrelated') db.exec('CREATE TABLE other (id INTEGER)');
      if (kind === 'foreign-keys') {
        db.pragma('foreign_keys = OFF'); // Construct an invalid legacy fixture, never disable protection in production.
        db.exec("UPDATE run_profiles SET project_id = 'missing'");
      }
      if (kind === 'future-version') db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
      db.close();
      if (kind === 'truncated') fs.truncateSync(databasePath, 8192);
    }
    const before = digest();
    await expect(start()).rejects.toMatchObject({ stage: 'inspect' });
    expect(digest()).toBe(before);
    expect(backups()).toEqual([]);
    expect(fs.existsSync(databasePath + '-wal')).toBe(false);
  });

  it('fails before migrating if the backup destination cannot be used', async () => {
    seed(databasePath, true).close();
    fs.writeFileSync(backupDirectory, 'occupied by a file');
    const before = digest();
    await expect(start()).rejects.toMatchObject({ stage: 'backup' });
    expect(digest()).toBe(before);
    expect(open().pragma('user_version', { simple: true })).toBe(0);
  });

  it('does not publish a damaged backup or migrate the source after verification fails', async () => {
    seed().close();
    const before = digest();
    const original = Database.prototype.backup;
    vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (this: DatabaseInstance, destination, options) {
      const result = await original.call(this, destination, options);
      fs.truncateSync(destination, 8192);
      return result;
    });
    await expect(start()).rejects.toMatchObject({ stage: 'backup' });
    expect(digest()).toBe(before);
    expect(backups()).toEqual([]);
    expect(fs.readdirSync(backupDirectory)).toHaveLength(1); // Pending evidence retained, not published.
  });

  it('rolls back the whole failed schema upgrade and closes its write connection', async () => {
    const original = seed(databasePath, true);
    original.exec('DROP TABLE service_sessions; DROP TABLE run_sessions; DROP TABLE service_configs; CREATE VIEW service_configs AS SELECT 1 AS id');
    const beforeSchema = original.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    original.close();
    await expect(start()).rejects.toMatchObject({ stage: 'initialize' });
    const after = open();
    expect(after.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()).toEqual(beforeSchema);
    expect(after.pragma('user_version', { simple: true })).toBe(0);
    expect(backups()).toHaveLength(1);
    after.exec('BEGIN EXCLUSIVE; ROLLBACK'); // Failed initializer has released its locks.
  });

  it('imports a legacy database through its checked WAL-aware snapshot without changing the original', async () => {
    const legacyPath = path.join(root, 'legacy.sqlite');
    const legacy = seed(legacyPath, true);
    legacy.pragma('journal_mode = WAL');
    legacy.pragma('wal_autocheckpoint = 0');
    legacy.exec("UPDATE projects SET name = 'legacy WAL'");
    const before = digest(legacyPath);
    const walBefore = digest(legacyPath + '-wal');
    const result = await openProtectedDatabase({ databasePath, backupDirectory, legacyDatabasePath: legacyPath });
    connections.push(result.db);
    expect(result.importedLegacy).toBe(true);
    expect(result.db.prepare('SELECT name FROM projects').pluck().get()).toBe('legacy WAL');
    expect(digest(legacyPath)).toBe(before);
    expect(digest(legacyPath + '-wal')).toBe(walBefore);
    expect(JSON.parse(fs.readFileSync(result.backup.manifestPath, 'utf8')).reason).toBe('legacy-import');
  });

  it.each(['backup', 'pending', '-wal', '-shm', '-journal'])('does not create an empty database when %s evidence remains', async (evidence) => {
    if (evidence === 'backup' || evidence === 'pending') {
      fs.mkdirSync(path.join(backupDirectory, evidence === 'pending' ? '.pending-interrupted' : 'previous'), { recursive: true });
    } else fs.writeFileSync(databasePath + evidence, 'keep');
    await expect(start()).rejects.toMatchObject({ stage: 'inspect' });
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('never falls back to a legacy file if the current database is corrupt', async () => {
    const legacyPath = path.join(root, 'legacy.sqlite');
    seed(legacyPath).close();
    fs.writeFileSync(databasePath, 'damaged current file');
    await expect(openProtectedDatabase({ databasePath, backupDirectory, legacyDatabasePath: legacyPath })).rejects.toMatchObject({ stage: 'inspect' });
    expect(fs.readFileSync(databasePath, 'utf8')).toBe('damaged current file');
  });
});
