import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA_SQL } from './schema.js';

export const DATABASE_SCHEMA_VERSION = 2;

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
      db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
