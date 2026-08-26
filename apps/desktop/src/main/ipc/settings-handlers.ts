import { ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels, AppSettingsDtoSchema } from '@codehelm/contracts';

const DEFAULT_SETTINGS = {
  theme: 'system' as const,
  maxScanFiles: 50000,
  maxLogRetentionDays: 14,
  maxLogRetentionMb: 500,
  enableAnonymousTelemetry: false,
};

function getSettings(db: DatabaseInstance) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('global') as { value: string } | undefined;
  if (!row) {
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
}

export function registerSettingsHandlers(db: DatabaseInstance) {
  ipcMain.handle(IpcChannels.SETTINGS_GET, async () => {
    return getSettings(db);
  });

  ipcMain.handle(IpcChannels.SETTINGS_UPDATE, async (_event, patch) => {
    const current = getSettings(db);
    const updated = AppSettingsDtoSchema.parse({ ...current, ...patch });

    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('global', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(updated));

    return updated;
  });
}
