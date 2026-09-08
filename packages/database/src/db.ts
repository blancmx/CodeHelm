import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA_SQL } from './schema.js';

export const DATABASE_SCHEMA_VERSION = 3;

/** Low-level initializer. Desktop startup must use openProtectedDatabase first. */
export function createDatabase(dbFilePath: string, options: { fileMustExist?: boolean } = {}): DatabaseInstance {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbFilePath, options);
  try {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > DATABASE_SCHEMA_VERSION) {
      throw new Error('数据库由更新版本的 CodeHelm 创建，请使用相应版本打开。');
    }
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // A failed upgrade must not leave a partially initialized schema.
    db.transaction(() => {
      db.exec(SCHEMA_SQL);
      const serviceColumns = db.prepare('PRAGMA table_info(service_configs)').all() as Array<{ name: string }>;
      if (!serviceColumns.some((column) => column.name === 'port_mode')) {
        db.exec("ALTER TABLE service_configs ADD COLUMN port_mode TEXT NOT NULL DEFAULT 'auto'");
      }
      const sessionColumns = db.prepare('PRAGMA table_info(service_sessions)').all() as Array<{ name: string }>;
      if (!sessionColumns.some((column) => column.name === 'recovery_json')) {
        db.exec('ALTER TABLE service_sessions ADD COLUMN recovery_json TEXT');
      }
      const profileColumns = db.prepare('PRAGMA table_info(run_profiles)').all() as Array<{ name: string }>;
      if (!profileColumns.some(c => c.name === 'deleted_at')) db.exec('ALTER TABLE run_profiles ADD COLUMN deleted_at TEXT');
      const runColumns = db.prepare('PRAGMA table_info(run_sessions)').all() as Array<{ name: string }>;
      if (!runColumns.some(c => c.name === 'profile_name')) db.exec('ALTER TABLE run_sessions ADD COLUMN profile_name TEXT');
      if (!runColumns.some(c => c.name === 'profile_updated_at')) db.exec('ALTER TABLE run_sessions ADD COLUMN profile_updated_at TEXT');
      // Older sessions have no historical name; capture the available name once.
      db.exec(`UPDATE run_sessions SET profile_name = (SELECT name FROM run_profiles WHERE id=run_profile_id) WHERE profile_name IS NULL`);
      db.exec(`UPDATE run_profiles SET is_default=0 WHERE is_default=1 AND id NOT IN
        (SELECT MIN(id) FROM run_profiles WHERE is_default=1 AND deleted_at IS NULL GROUP BY project_id)`);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_default ON run_profiles(project_id) WHERE is_default=1 AND deleted_at IS NULL');
      db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_history ON run_sessions(started_at DESC,id DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_service_sessions_run ON service_sessions(run_session_id)');
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
