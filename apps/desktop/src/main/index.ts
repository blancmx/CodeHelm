import { createTrustedIpcRegistrar } from './ipc/trusted-ipc.js';
import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { openProtectedDatabase } from '@codehelm/database';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import { registerAllIpcHandlers, stopAllRunnerSessions, closeLogStorage, closeAnalysisTasks } from './ipc/index.js';
import { APP_NAME, WINDOWS_APP_ID, createWindowsAppDetails } from './windows-app-details.js';
import { presentMainWindow } from './window-presentation.js';
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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Rejection:', reason);
});

const handleTrustedIpc = createTrustedIpcRegistrar(() => ({ window: mainWindow, renderer: trustedRenderer }));

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

app.whenReady().then(async () => {
  if (!gotTheLock) return;
  console.log('[Main] Electron app is ready.');

  const dbPath = path.join(app.getPath('userData'), 'codehelm.sqlite');
  const backupDirectory = path.join(app.getPath('userData'), 'backups');
  try {
    console.log('[Main] Initializing database at:', dbPath);
    const opened = await openProtectedDatabase({
      databasePath: dbPath, backupDirectory,
      legacyDatabasePath: requestedUserDataPath
        ? undefined
        : path.join(legacyUserDataPath, 'codehelm.sqlite'),
    });
    db = opened.db;
    if (isQuitting) { db.close(); db = null; return; }
    console.log('[Main] Verified startup backup:', opened.backup.manifestPath);
    if (opened.importedLegacy) console.log('[Main] Imported verified legacy snapshot into:', dbPath);
    await registerAllIpcHandlers(db, handleTrustedIpc);
    registerWindowIpcHandlers();
    console.log('[Main] IPC handlers registered successfully.');
  } catch (dbErr) {
    console.error('[Main] Failed to initialize database or IPC handlers:', dbErr);
    db?.close();
    db = null;
    // Fail closed before opening a renderer; missing IPC must never look like an empty project library.
    await dialog.showMessageBox({
      type: 'error', title: 'CodeHelm 数据库保护', message: '无法安全打开项目数据库',
      detail: `${dbErr instanceof Error ? dbErr.message : '数据库初始化失败。'}\n\n数据库：${dbPath}\n备份目录：${backupDirectory}\n\n请保留上述文件。退出后检查磁盘空间和权限，或联系维护者核验备份；不要删除数据库或覆盖原文件。`,
      buttons: ['退出应用'], defaultId: 0, cancelId: 0, noLink: true,
    });
    app.quit();
    return;
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void stopAllRunnerSessions()
    .catch((error) => {
      console.error('[Main] Failed to stop runner sessions during quit:', error);
    })
    .finally(async () => {
      try {
        await closeAnalysisTasks();
        await closeLogStorage();
        db?.close();
      } catch (error) {
        console.error('[Main] Failed to close storage during quit:', error);
      } finally { app.exit(0); }
    });
});
