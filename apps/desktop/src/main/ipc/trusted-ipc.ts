import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { isTrustedRendererUrl, type TrustedRenderer } from '../renderer-security.js';

export type RegisterIpcHandler = typeof ipcMain.handle;

export interface TrustedIpcContext {
  window: BrowserWindow | null;
  renderer: TrustedRenderer | null;
}

function isTrustedInvocation(event: IpcMainInvokeEvent, context: TrustedIpcContext): boolean {
  const { window, renderer } = context;
  if (!window || window.isDestroyed() || !renderer) return false;
  const contents = window.webContents;
  if (contents.isDestroyed() || event.sender !== contents) return false;
  const frame = event.senderFrame;
  return !!frame && !frame.detached && frame === contents.mainFrame
    && isTrustedRendererUrl(frame.url, renderer)
    && isTrustedRendererUrl(contents.getURL(), renderer);
}

// Resolve live identity on every invocation: registrations outlive navigation,
// dev-to-file fallback, and replacement windows. Never cache a trusted sender.
export function createTrustedIpcRegistrar(getContext: () => TrustedIpcContext): RegisterIpcHandler {
  return (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      let trusted = false;
      try { trusted = isTrustedInvocation(event, getContext()); }
      catch { /* Destroyed/detached Electron objects must fail closed. */ }
      if (!trusted) throw new Error('IPC 来源校验失败：请求必须来自应用主窗口的可信顶层页面。');
      // Keep business errors and synchronous/asynchronous return semantics intact.
      return listener(event, ...args);
    });
  };
}
