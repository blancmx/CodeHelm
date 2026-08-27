import type { Database as DatabaseInstance } from 'better-sqlite3';
import { AppSettingsDtoSchema, AppSettingsPatchSchema, type AppSettingsDto } from '@codehelm/contracts';

function persist(db: DatabaseInstance, settings: AppSettingsDto): void {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('global', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(settings));
}

export function getAppSettings(db: DatabaseInstance): AppSettingsDto {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('global') as { value: string } | undefined;
  if (!row) return AppSettingsDtoSchema.parse({});
  const stored = JSON.parse(row.value);
  // Older settings allowed 500,000 even though discovery always capped at 50,000.
  const legacyLimit = stored && Number.isInteger(stored.maxScanFiles)
    && stored.maxScanFiles > 50000 && stored.maxScanFiles <= 500000;
  const settings = AppSettingsDtoSchema.parse(legacyLimit ? { ...stored, maxScanFiles: 50000 } : stored);
  if (legacyLimit) persist(db, settings);
  return settings;
}

export function updateAppSettings(db: DatabaseInstance, rawPatch: unknown): AppSettingsDto {
  const patch = AppSettingsPatchSchema.parse(rawPatch);
  const updated = AppSettingsDtoSchema.parse({ ...getAppSettings(db), ...patch });
  persist(db, updated);
  return updated;
}
