import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA_SQL } from './schema.js';

export function createDatabase(dbFilePath: string): DatabaseInstance {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbFilePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize tables
  db.exec(SCHEMA_SQL);

  // Lightweight forward-only migrations for databases created by older builds.
  const serviceColumns = db.prepare('PRAGMA table_info(service_configs)').all() as Array<{ name: string }>;
  if (!serviceColumns.some((column) => column.name === 'port_mode')) {
    db.exec("ALTER TABLE service_configs ADD COLUMN port_mode TEXT NOT NULL DEFAULT 'auto'");
  }

  return db;
}
