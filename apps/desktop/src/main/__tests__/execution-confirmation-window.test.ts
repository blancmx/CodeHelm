import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow, ipcMain } from 'electron';
import { showExecutionConfirmation } from '../execution-confirmation-window.js';
import { renderExecutionReview, type ExecutionReview } from '../execution-confirmation-page.js';

const harness = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    dead = false;
    webContents = Object.assign(new EventEmitter(), {
      id: harness.windows.length, mainFrame: {},
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      setWindowOpenHandler: vi.fn(),
    });
    constructor(public options: unknown) { super(); harness.windows.push(this); }
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; this.emit('closed'); }
    removeMenu = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(async () => {});
  }
  return { BrowserWindow: Window, ipcMain: new EventEmitter() };
});

const review: ExecutionReview = {
  projectRoot: 'E:/fixture', mode: 'start', theme: 'dark', plans: [],
  profile: { id: 'profile', projectId: 'project', name: '测试方案', isDefault: true, failurePolicy: 'continue',
    createdAt: '', updatedAt: '', services: [{ id: 'service', runProfileId: 'profile', name: 'HTTP',
      executable: 'node', args: ['server.cjs', '{{PORT}}'], cwdRelative: '.', moduleRelativePath: '.',
      env: [], enabled: true, source: 'manual', type: 'backend', port: 48480, dependsOn: [],
    }],
  },
};
const channel = 'codehelm:execution-review:decision';
afterEach(() => {
  for (const win of harness.windows.splice(0)) if (!win.isDestroyed()) win.destroy();
});
async function open() {
  const owner = new BrowserWindow();
  const result = showExecutionConfirmation(owner, review);
  const win = harness.windows.at(-1);
  await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
  return { owner, win, result };
}
const event = (win: any) => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });

describe('isolated execution confirmation', () => {
  it('accepts only the review window main frame and cleans up after one answer', async () => {
    const { owner, win, result } = await open();
    let answered = false;
    void result.then(() => { answered = true; });
    ipcMain.emit(channel, event(owner), true);
    ipcMain.emit(channel, { ...event(win), senderFrame: {} }, true);
    ipcMain.emit(channel, event(win), 'true');
    await Promise.resolve();
    expect(answered).toBe(false);
    expect(win.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    ipcMain.emit(channel, event(win), true);
    expect(await result).toBe(true);
    expect(win.isDestroyed()).toBe(true);
    expect(ipcMain.listenerCount(channel)).toBe(0);
    expect(owner.listenerCount('closed')).toBe(0);
  });

  it.each(['cancel', 'close', 'owner-close', 'navigation', 'renderer-crash', 'preload-failure'])(
    'fails closed on %s', async reason => {
      const { owner, win, result } = await open();
      const outcome = result.catch(error => error.message);
      if (reason === 'cancel') ipcMain.emit(channel, event(win), false);
      if (reason === 'close') win.destroy();
      if (reason === 'owner-close') owner.destroy();
      if (reason === 'navigation') owner.webContents.emit('did-start-navigation');
      if (reason === 'renderer-crash') win.webContents.emit('render-process-gone');
      if (reason === 'preload-failure') win.webContents.emit('preload-error', {}, 'preload', new Error('preload failed'));
      expect(await outcome).toBe(reason === 'preload-failure' ? 'preload failed' : false);
      expect(ipcMain.listenerCount(channel)).toBe(0);
    },
  );

  it('refuses duplicate windows and cancels unexpected navigation', async () => {
    const { owner, win, result } = await open();
    await expect(showExecutionConfirmation(owner, review)).rejects.toThrow('已有启动确认');
    const navigation = { preventDefault: vi.fn() };
    win.webContents.emit('will-navigate', navigation);
    expect(navigation.preventDefault).toHaveBeenCalledOnce();
    expect(await result).toBe(false);
  });

  it('renders untrusted fields as text, masks secrets and explicitly shows install scope', () => {
    const data = structuredClone(review);
    data.profile.name = '<script>alert(1)</script>';
    data.profile.services[0].env = [{ key: 'TOKEN', value: 'secret-value', isSecret: true }];
    data.profile.services[0].args.push('secret-value');
    data.profile.services[0].executable = 'C:\\Program Files\\nodejs\\node.exe';
    data.mode = 'install'; data.theme = 'light';
    data.plans = [{ key: 'npm', label: 'npm', executable: 'npm', args: ['install'], cwd: 'E:/fixture' }];
    const html = renderExecutionReview(data, 'nonce');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('secret-value');
    expect(html).toContain('&quot;C:\\Program Files\\nodejs\\node.exe&quot;');
    expect(html).toContain("script-src 'none'");
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('npm install');
    expect(html).toContain('确认安装并启动');
  });
});
