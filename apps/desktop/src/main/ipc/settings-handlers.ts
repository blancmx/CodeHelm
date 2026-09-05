import type { RegisterIpcHandler } from './trusted-ipc.js';
import { shell } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import { getAppSettings, updateAppSettings } from './app-settings.js';
import type { LogStorage } from './log-storage.js';

export function registerSettingsHandlers(handle: RegisterIpcHandler, db: DatabaseInstance, logs: LogStorage) {
  handle(IpcChannels.SETTINGS_GET, () => getAppSettings(db));
  handle(IpcChannels.SETTINGS_UPDATE, (_event, patch) => updateAppSettings(db, patch));
  handle(IpcChannels.SETTINGS_LOG_STATUS, () => logs.getStatus());
  handle(IpcChannels.SETTINGS_CLEAR_LOGS, () => logs.clear());
  handle(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY, async () => {
    const directory = await logs.getDirectoryForOpen();
    const error = await shell.openPath(directory);
    if (error) throw new Error(`无法打开日志目录：${error}`);
  });
}
