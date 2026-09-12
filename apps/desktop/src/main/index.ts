import { createTrustedIpcRegistrar } from './ipc/trusted-ipc.js';
import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { CODEHELM_APP_VERSION } from './app-version.js';
import { registerBackupHandlers,databaseBackupPolicy } from './ipc/backup-handlers.js';
import { MaintenanceGate } from './ipc/maintenance-gate.js';
import { assertRunnerStopped } from './ipc/runner-handlers.js';
import {
  openProtectedDatabase,
  startPeriodicDatabaseBackups,
  DEFAULT_DATABASE_BACKUP_POLICY,
  type DatabaseBackupMaintenanceResult,
  type PeriodicDatabaseBackupController,
} from '@codehelm/database';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import { registerAllIpcHandlers, stopAllRunnerSessions, closeLogStorage, closeAnalysisTasks } from './ipc/index.js';
import { APP_NAME, WINDOWS_APP_ID, createWindowsAppDetails } from './windows-app-details.js';
import { TrayController } from './tray-controller.js';
import { getAppSettings } from './ipc/app-settings.js';
import { presentMainWindow } from './window-presentation.js';
import {
  createDatabaseBackupRetentionWarning,
  createPeriodicDatabaseBackupWarning,
  createStartupDatabaseErrorDialog,
} from './database-backup-dialog.js';
import {
  createTrustedDevRenderer,
  createTrustedFileRenderer,
  isExternalHttpUrl,
  isTrustedRendererUrl,
  type TrustedRenderer,
} from './renderer-security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Remove default application menu globally
Menu.setApplicationMenu(null);

// In development Electron derives userData from the scoped package name
// "@codehelm/desktop". On Windows that becomes a nested path and Chromium can
// fail to create its singleton/cache files there. Use the same stable path in
// development and packaged builds before requesting the single-instance lock.
// An explicit data-root override is reserved for isolated acceptance/diagnostic
// runs; normal development and packaged launches continue to use the stable
// per-user CodeHelm directory.
const requestedUserDataPath = process.env.CODEHELM_USER_DATA_DIR?.trim();
const legacyUserDataPath = app.getPath('userData');
const stableUserDataPath = requestedUserDataPath
  ? path.resolve(requestedUserDataPath)
  : path.join(app.getPath('appData'), 'CodeHelm');
const stableSessionDataPath = path.join(stableUserDataPath, 'SessionData');
fs.mkdirSync(stableSessionDataPath, { recursive: true });
app.setName(APP_NAME);
app.setPath('userData', stableUserDataPath);
app.setPath('sessionData', stableSessionDataPath);

// Application state
let mainWindow: BrowserWindow | null = null;
let db: DatabaseInstance | null = null;
let databaseBackupController: PeriodicDatabaseBackupController | null = null;
let databaseManagement:ReturnType<typeof registerBackupHandlers>|undefined;
let startupBackupMaintenance: DatabaseBackupMaintenanceResult | null = null;
let databaseBackupWarningOpen = false;
let databaseBackupFailureNotified = false;
let databaseBackupRetentionNotified = false;
let trustedRenderer: TrustedRenderer | null = null;
let isQuitting = false;
// The validation harness may request a native frame so Windows UI discovery
// can target the otherwise frameless application window. Normal launches keep
// the custom title bar unchanged.
const validationWindowFrame = process.env.CODEHELM_VALIDATION_WINDOW === '1';

// Set Windows taskbar AppUserModelId for stable icon grouping
if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_ID);
}

function getAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(__dirname, '../../resources/icon.png'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(__dirname, '../../public/icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

// Handle single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Another instance is already running. Quitting.');
  app.exit(0);
} else {
  app.on('second-instance', () => showMainWindow());
}

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Rejection:', reason);
});

const handleTrustedIpc = createTrustedIpcRegistrar(() => ({ window: mainWindow, renderer: trustedRenderer }));
const maintenanceGate=new MaintenanceGate();

function showMainWindow() {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  presentMainWindow(mainWindow);
}

let trayController: TrayController | undefined;
async function applyCloseToTray(enabled: boolean, confirm = true): Promise<boolean> {
  if (isQuitting || !trayController) throw new Error('应用正在启动或退出，请稍后重试。');
  if (confirm && enabled && !trayController.enabled) {
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: 'question', title: '启用关闭到托盘',
      message: '关闭窗口后，CodeHelm 和已启动的服务仍会继续运行。',
      detail: '点击托盘图标可恢复窗口。要停止受管服务并退出，请使用托盘菜单“退出 CodeHelm”。不会自动启动项目。',
      buttons: ['取消', '启用关闭到托盘'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (isQuitting) throw new Error('应用正在退出。');
    if (choice.response !== 1) return false;
  }
  trayController?.setEnabled(enabled);
  return enabled;
}

function registerWindowIpcHandlers() {
  handleTrustedIpc(IpcChannels.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });
  handleTrustedIpc(IpcChannels.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });
  handleTrustedIpc(IpcChannels.WINDOW_CLOSE, () => {
    mainWindow?.close();
  });
  handleTrustedIpc(IpcChannels.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    presentMainWindow(mainWindow);
    return;
  }

  console.log('[Main] Creating main browser window...');
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  console.log('[Main] Preload path:', preloadPath);

  const iconPath = getAppIconPath();
  if (iconPath) {
    console.log('[Main] Using app icon:', iconPath);
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const trustedDevRenderer = !app.isPackaged
    ? createTrustedDevRenderer(devServerUrl)
    : null;
  console.log('[Main] VITE_DEV_SERVER_URL:', devServerUrl);

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    frame: validationWindowFrame,
    ...(validationWindowFrame ? {} : { titleBarStyle: 'hidden' as const }),
    show: false, // Apply taskbar identity before Windows first displays the button.
    backgroundColor: '#09090b',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  trustedRenderer = null;

  if (process.platform === 'win32') {
    mainWindow.setAppDetails(createWindowsAppDetails({
      executablePath: process.execPath,
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      iconPath,
    }));
  }

  if (iconPath) {
    mainWindow.setIcon(iconPath);
  }

  mainWindow.removeMenu();
  mainWindow.on('close', event => {
    if (!isQuitting && trayController?.enabled) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; trustedRenderer = null; });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IpcChannels.WINDOW_ON_MAXIMIZE_CHANGE, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IpcChannels.WINDOW_ON_MAXIMIZE_CHANGE, false);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] Failed to load URL "${validatedURL}": ${errorDescription} (${errorCode})`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Render process gone:', details);
  });

  // Safe navigation: external links open in user default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedRendererUrl(url, trustedRenderer)) return;
    event.preventDefault();
    if (isExternalHttpUrl(url)) shell.openExternal(url);
  };
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation);
  mainWindow.webContents.on('will-redirect', preventUntrustedNavigation);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (trustedDevRenderer) {
    try {
      console.log('[Main] Loading trusted dev server URL:', trustedDevRenderer.url);
      trustedRenderer = trustedDevRenderer.renderer;
      await mainWindow.loadURL(trustedDevRenderer.url);
      console.log('[Main] Dev server URL loaded successfully');
    } catch (err) {
      console.error('[Main] Error loading dev server URL:', err);
      await loadLocalRenderer(mainWindow);
    }
  } else {
    if (devServerUrl) {
      console.error('[Main] Refusing non-loopback VITE_DEV_SERVER_URL:', devServerUrl);
    }
    await loadLocalRenderer(mainWindow);
  }

  // Showing and focusing is sufficient here. Temporarily toggling always-on-top
  // caused an unnecessary Windows compositor/z-order transition during startup.
  presentMainWindow(mainWindow);
}

async function loadLocalRenderer(window: BrowserWindow): Promise<void> {
  const candidatePaths = [
    path.join(__dirname, '../../dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
    path.join(__dirname, '../renderer/index.html'),
  ];
  const targetPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Renderer entry not found. Checked: ${candidatePaths.join(', ')}`);
  }
  console.log('[Main] Loading local file:', targetPath);
  trustedRenderer = createTrustedFileRenderer(targetPath);
  await window.loadFile(targetPath);
}

async function showPeriodicBackupWarning(error: unknown, backupDirectory: string): Promise<void> {
  if (databaseBackupWarningOpen || databaseBackupFailureNotified || isQuitting) return;
  databaseBackupWarningOpen = true;
  databaseBackupFailureNotified = true;
  const options = createPeriodicDatabaseBackupWarning(error, backupDirectory);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
    else await dialog.showMessageBox(options);
  } finally { databaseBackupWarningOpen = false; }
}

async function showBackupRetentionWarning(
  retainedBackups: number,
  retainedBytes: number,
  backupDirectory: string,
): Promise<void> {
  if (databaseBackupWarningOpen || databaseBackupRetentionNotified || isQuitting) return;
  databaseBackupWarningOpen = true;
  databaseBackupRetentionNotified = true;
  const options = createDatabaseBackupRetentionWarning(
    retainedBackups,
    retainedBytes,
    DEFAULT_DATABASE_BACKUP_POLICY.maxBackups,
    DEFAULT_DATABASE_BACKUP_POLICY.maxTotalBytes,
    backupDirectory,
  );
  try {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
    else await dialog.showMessageBox(options);
  } finally { databaseBackupWarningOpen = false; }
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;
  console.log('[Main] Electron app is ready.');

  const dbPath = path.join(app.getPath('userData'), 'codehelm.sqlite');
  const backupDirectory = path.join(app.getPath('userData'), 'backups');
  try {
    console.log('[Main] Initializing database at:', dbPath);
    const opened = await openProtectedDatabase({
      databasePath: dbPath, backupDirectory,backupPolicy:databaseBackupPolicy(backupDirectory),appVersion:CODEHELM_APP_VERSION,
      legacyDatabasePath: requestedUserDataPath
        ? undefined
        : path.join(legacyUserDataPath, 'codehelm.sqlite'),
    });
    db = opened.db;
    startupBackupMaintenance = opened.backup.maintenance;
    if (isQuitting) { db.close(); db = null; return; }
    console.log('[Main] Verified startup backup:', opened.backup.manifestPath);
    if (opened.importedLegacy) console.log('[Main] Imported verified legacy snapshot into:', dbPath);
    await registerAllIpcHandlers(db, maintenanceGate.wrap(handleTrustedIpc), applyCloseToTray);
    databaseManagement=registerBackupHandlers(handleTrustedIpc,db,backupDirectory,{
      pausePeriodic:async()=>{await databaseBackupController?.stop();databaseBackupController=null;},
      resumePeriodic:()=>{if(!isQuitting&&db&&!databaseBackupController) startBackups();},
      quiesce:async()=>{
        maintenanceGate.close();
        await stopAllRunnerSessions();await closeAnalysisTasks();
        await maintenanceGate.drain();assertRunnerStopped();await closeLogStorage();
      },
    });
    registerWindowIpcHandlers();
    console.log('[Main] IPC handlers registered successfully.');
  } catch (dbErr) {
    console.error('[Main] Failed to initialize database or IPC handlers:', dbErr);
    db?.close();
    db = null;
    // Fail closed before opening a renderer; missing IPC must never look like an empty project library.
    await dialog.showMessageBox(createStartupDatabaseErrorDialog(dbErr, dbPath, backupDirectory));
    app.quit();
    return;
  }

  await createWindow();
  if (isQuitting || !db) return;
  trayController = new TrayController({
    iconPath: getAppIconPath(), showWindow: showMainWindow,
    showRunner: () => {
      showMainWindow();
      if (!isQuitting && mainWindow && isTrustedRendererUrl(mainWindow.webContents.getURL(), trustedRenderer)) {
        void mainWindow.webContents.executeJavaScript("location.hash = '/runner'").catch(console.error);
      }
    },
    quit: () => app.quit(),
  });
  try { trayController.setEnabled(getAppSettings(db!).closeToTray); }
  catch (error) {
    console.error('[Main] Tray unavailable:', error);
    dialog.showErrorBox('系统托盘不可用', '本次启动仍使用关闭窗口退出。可在设置中重新启用关闭到托盘。');
  }
  if (startupBackupMaintenance && !startupBackupMaintenance.limitsSatisfied) {
    console.warn('[Main] Verified startup backups remain above retention limits:', startupBackupMaintenance);
    await showBackupRetentionWarning(
      startupBackupMaintenance.retainedBackups,
      startupBackupMaintenance.retainedBytes,
      backupDirectory,
    );
  }
  if (isQuitting || !db) return;
  startBackups();

  function startBackups() {
    if(!db||databaseBackupController)return;
    databaseBackupController = startPeriodicDatabaseBackups({
    source: db,
    sourcePath: dbPath,
    backupDirectory,
    appVersion:CODEHELM_APP_VERSION,getPolicy:()=>databaseBackupPolicy(backupDirectory),
    onSuccess: (backup) => {
      databaseBackupFailureNotified = false;
      console.log('[Main] Verified periodic database backup:', backup.manifestPath);
      if (backup.maintenance.removedDirectories.length > 0) {
        console.log('[Main] Pruned verified database backups:', backup.maintenance.removedDirectories.length);
      }
      if (backup.maintenance.limitsSatisfied) {
        databaseBackupRetentionNotified = false;
      } else {
        console.warn('[Main] Verified backups remain above retention limits:', backup.maintenance);
        void showBackupRetentionWarning(
          backup.maintenance.retainedBackups,
          backup.maintenance.retainedBytes,
          backupDirectory,
        );
      }
    },
    onError: (error) => {
      console.error('[Main] Periodic database backup failed:', error);
      void showPeriodicBackupWarning(error, backupDirectory);
    },
    });
  }

  app.on('activate', () => {
    if (isQuitting) return;
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  event.preventDefault();
  if (isQuitting) return;
  isQuitting = true;
  maintenanceGate.close();
  trayController?.dispose();
  void stopAllRunnerSessions()
    .catch((error) => {
      console.error('[Main] Failed to stop runner sessions during quit:', error);
    })
    .finally(async () => {
      try {
          await databaseBackupController?.stop();
          await databaseManagement?.waitForIdle();
        databaseBackupController = null;
        await closeAnalysisTasks();
        await closeLogStorage();
        db?.close();
      } catch (error) {
        console.error('[Main] Failed to close storage during quit:', error);
      } finally { app.exit(0); }
    });
});
