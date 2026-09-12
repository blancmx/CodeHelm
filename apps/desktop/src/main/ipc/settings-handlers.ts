import type { RegisterIpcHandler } from './trusted-ipc.js';
import { shell } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { AppSettingsPatchSchema, IpcChannels } from '@codehelm/contracts';
import { getAppSettings, updateAppSettings } from './app-settings.js';
import type { LogStorage } from './log-storage.js';

export function registerSettingsHandlers(handle: RegisterIpcHandler, db: DatabaseInstance, logs: LogStorage, applyCloseToTray?: (enabled: boolean, confirm?: boolean) => Promise<boolean>) {
  let updating = false;
  handle(IpcChannels.SETTINGS_GET, () => getAppSettings(db));
  handle(IpcChannels.SETTINGS_UPDATE, async (_event, rawPatch) => {
    if (updating) throw new Error('设置正在保存，请稍后重试。');
    const patch = AppSettingsPatchSchema.parse(rawPatch);
    const previous = getAppSettings(db).closeToTray;
    updating = true;
    try {
      if (patch.closeToTray !== undefined && applyCloseToTray) {
        patch.closeToTray = await applyCloseToTray(patch.closeToTray);
      }
      return updateAppSettings(db, patch);
    } catch (error) {
      if (patch.closeToTray !== undefined && applyCloseToTray) await applyCloseToTray(previous, false).catch(() => undefined);
      throw error;
    } finally { updating = false; }
  });
  handle(IpcChannels.SETTINGS_LOG_STATUS, () => logs.getStatus());
  handle(IpcChannels.SETTINGS_CLEAR_LOGS, () => logs.clear());
  handle(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY, async () => {
    const directory = await logs.getDirectoryForOpen();
    const error = await shell.openPath(directory);
    if (error) throw new Error(`无法打开日志目录：${error}`);
  });
}
