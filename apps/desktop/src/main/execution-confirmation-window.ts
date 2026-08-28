import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderExecutionReview, type ExecutionReview } from './execution-confirmation-page.js';

const DECISION_CHANNEL = 'codehelm:execution-review:decision';
const pendingOwners = new Set<number>();

export async function showExecutionConfirmation(owner: BrowserWindow, review: ExecutionReview): Promise<boolean> {
  if (owner.isDestroyed()) throw new Error('启动窗口已关闭。');
  const ownerId = owner.webContents.id;
  if (pendingOwners.has(ownerId)) throw new Error('已有启动确认窗口，请先完成或取消。');
  pendingOwners.add(ownerId);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const nonce = randomBytes(24).toString('base64');
      const win = new BrowserWindow({
        parent: owner, modal: true, show: false, frame: false, title: 'CodeHelm · 启动确认',
        width: 760, height: 680, minWidth: 560, minHeight: 420, skipTaskbar: true,
        minimizable: false, maximizable: false, backgroundColor: review.theme === 'light' ? '#fafafa' : '#121216',
        webPreferences: {
          preload: fileURLToPath(new URL(/* @vite-ignore */ '../review-preload/execution-confirmation.cjs', import.meta.url)),
          nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: false,
          webviewTag: false, partition: `codehelm-review-${randomBytes(16).toString('hex')}`,
        },
      });
      let settled = false;
      let ready = false;
      const finish = (approved: boolean, error?: Error) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener(DECISION_CHANNEL, onDecision);
        owner.removeListener('closed', cancel);
        owner.webContents.removeListener('did-start-navigation', cancel);
        owner.webContents.removeListener('render-process-gone', cancel);
        if (!win.isDestroyed()) win.destroy();
        if (error) reject(error); else resolve(approved);
      };
      const cancel = () => finish(false);
      const onDecision = (event: IpcMainEvent, approved: unknown) => {
        if (!ready || win.isDestroyed() || event.sender !== win.webContents
          || event.senderFrame !== win.webContents.mainFrame || typeof approved !== 'boolean') return;
        finish(approved);
      };
      ipcMain.on(DECISION_CHANNEL, onDecision);
      owner.once('closed', cancel);
      owner.webContents.on('did-start-navigation', cancel);
      owner.webContents.once('render-process-gone', cancel);
      win.once('closed', cancel);
      win.webContents.once('render-process-gone', cancel);
      win.webContents.once('preload-error', (_event, _path, error) => finish(false, error));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => { event.preventDefault(); cancel(); });
      win.webContents.on('will-redirect', event => { event.preventDefault(); cancel(); });
      win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      win.webContents.session.setPermissionCheckHandler(() => false);
      win.removeMenu();
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderExecutionReview(review, nonce))}`)
        .then(() => { if (!settled) { ready = true; win.show(); win.focus(); } })
        .catch(error => finish(false, error));
    });
  } finally { pendingOwners.delete(ownerId); }
}
