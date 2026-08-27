import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createDatabase } from '@codehelm/database';
import { IpcChannels } from '@codehelm/contracts';
import { registerAllIpcHandlers, stopAllRunnerSessions } from './ipc/index.js';
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
const legacyUserDataPath = app.getPath('userData');
const stableUserDataPath = path.join(app.getPath('appData'), 'CodeHelm');
const stableSessionDataPath = path.join(stableUserDataPath, 'SessionData');
fs.mkdirSync(stableSessionDataPath, { recursive: true });
app.setName('CodeHelm');
app.setPath('userData', stableUserDataPath);
app.setPath('sessionData', stableSessionDataPath);

// Application state
let mainWindow: BrowserWindow | null = null;
let db: any = null;
let trustedRenderer: TrustedRenderer | null = null;
let isQuitting = false;

// Set Windows taskbar AppUserModelId for stable icon grouping
if (process.platform === 'win32') {
  app.setAppUserModelId('com.codehelm.desktop');
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

function registerWindowIpcHandlers() {
  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });
  ipcMain.handle(IpcChannels.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });
  ipcMain.handle(IpcChannels.WINDOW_CLOSE, () => {
    mainWindow?.close();
  });
  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  console.log('[Main] Creating main browser window...');
  const preloadPath = path.join(__dirname, '../preload/index.js');
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
    title: 'CodeHelm',
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    show: true,
    backgroundColor: '#09090b',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  trustedRenderer = null;

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

  // Force show and bring to front on Windows
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 400);
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

function migrateLegacyDatabase(): void {
  if (path.resolve(legacyUserDataPath) === path.resolve(stableUserDataPath)) return;
  const legacyDatabase = path.join(legacyUserDataPath, 'codehelm.sqlite');
  const stableDatabase = path.join(stableUserDataPath, 'codehelm.sqlite');
  if (!fs.existsSync(legacyDatabase) || fs.existsSync(stableDatabase)) return;

  fs.copyFileSync(legacyDatabase, stableDatabase, fs.constants.COPYFILE_EXCL);
  console.log('[Main] Migrated legacy database to:', stableDatabase);
}

app.whenReady().then(() => {
  if (!gotTheLock) return;
  console.log('[Main] Electron app is ready.');

  try {
    migrateLegacyDatabase();
    const dbPath = path.join(app.getPath('userData'), 'codehelm.sqlite');
    console.log('[Main] Initializing database at:', dbPath);
    db = createDatabase(dbPath);
    registerAllIpcHandlers(db);
    registerWindowIpcHandlers();
    console.log('[Main] IPC handlers registered successfully.');
  } catch (dbErr) {
    console.error('[Main] Failed to initialize database or IPC handlers:', dbErr);
  }

  createWindow();

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
    .finally(() => app.exit(0));
});
