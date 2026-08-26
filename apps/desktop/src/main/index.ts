import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createDatabase } from '@codehelm/database';
import { registerAllIpcHandlers } from './ipc/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  mainWindow = new BrowserWindow({
    title: 'CodeHelm - 本地项目控制台',
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    frame: true,
    show: true,
    backgroundColor: '#0d0d11',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
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
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  console.log('[Main] VITE_DEV_SERVER_URL:', devServerUrl);

  if (devServerUrl) {
    try {
      console.log('[Main] Loading dev server URL:', devServerUrl);
      await mainWindow.loadURL(devServerUrl);
      console.log('[Main] Dev server URL loaded successfully');
    } catch (err) {
      console.error('[Main] Error loading dev server URL:', err);
      await loadLocalRenderer(mainWindow);
    }
  } else {
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
