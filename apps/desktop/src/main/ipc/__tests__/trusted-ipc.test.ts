import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTrustedIpcRegistrar } from '../trusted-ipc.js';
import { createTrustedFileRenderer } from '../../renderer-security.js';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: (...args: any[]) => any) => handlers.set(channel, listener) },
}));

function fixture() {
  const frame = { url: 'http://localhost:15173/#/overview', detached: false };
  const contents = { mainFrame: frame, getURL: vi.fn(() => frame.url), isDestroyed: vi.fn(() => false) };
  const window = { webContents: contents, isDestroyed: vi.fn(() => false) };
  const context: any = { window, renderer: { kind: 'dev', origin: 'http://localhost:15173' } };
  const event: any = { sender: contents, senderFrame: frame };
  const listener = vi.fn((_event, ...args) => args);
  createTrustedIpcRegistrar(() => context)('test:guarded', listener);
  return { frame, contents, window, context, event, listener, invoke: (...args: unknown[]) => handlers.get('test:guarded')!(event, ...args) };
}

describe('trusted IPC registration boundary', () => {
  it('preserves the original event, arguments, synchronous result, and business errors', () => {
    const f = fixture();
    const payload = { projectId: 'synthetic-project' };
    expect(f.invoke(payload, 3)).toEqual([payload, 3]);
    expect(f.listener).toHaveBeenCalledWith(f.event, payload, 3);
    const error = new Error('business rejection');
    f.listener.mockImplementationOnce(() => { throw error; });
    expect(() => f.invoke()).toThrow(error);
  });

  it('preserves asynchronous resolution and rejection', async () => {
    const f = fixture();
    const value = Promise.resolve(['ok']);
    f.listener.mockReturnValueOnce(value as any);
    expect(f.invoke()).toBe(value);
    f.listener.mockImplementationOnce(() => Promise.reject(new Error('async business rejection')) as any);
    await expect(f.invoke()).rejects.toThrow('async business rejection');
  });

  it.each([
    ['no current window', (f: ReturnType<typeof fixture>) => { f.context.window = null; }],
    ['no renderer trust', (f: ReturnType<typeof fixture>) => { f.context.renderer = null; }],
    ['destroyed window', (f: ReturnType<typeof fixture>) => f.window.isDestroyed.mockReturnValue(true)],
    ['destroyed contents', (f: ReturnType<typeof fixture>) => f.contents.isDestroyed.mockReturnValue(true)],
    ['another window with the same URL', (f: ReturnType<typeof fixture>) => { f.event.sender = { ...f.contents }; }],
    ['trusted-URL child frame', (f: ReturnType<typeof fixture>) => { f.event.senderFrame = { ...f.frame }; }],
    ['null frame', (f: ReturnType<typeof fixture>) => { f.event.senderFrame = null; }],
    ['detached frame', (f: ReturnType<typeof fixture>) => { f.frame.detached = true; }],
    ['replaced main frame', (f: ReturnType<typeof fixture>) => { f.contents.mainFrame = { ...f.frame }; }],
    ['frame navigated away', (f: ReturnType<typeof fixture>) => { f.frame.url = 'about:blank'; f.contents.getURL.mockReturnValue('http://localhost:15173/'); }],
    ['contents navigated away', (f: ReturnType<typeof fixture>) => f.contents.getURL.mockReturnValue('about:blank')],
    ['destroyed getter throws', (f: ReturnType<typeof fixture>) => f.contents.getURL.mockImplementation(() => { throw new Error('gone'); })],
  ])('rejects %s before entering business code', (_name, change) => {
    const f = fixture();
    change(f);
    expect(() => f.invoke('sensitive input')).toThrow('IPC 来源校验失败');
    expect(f.listener).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost.evil.test:15173/', 'http://localhost:15174/',
    'https://localhost:15173/', 'http://user:pass@localhost:15173/',
    'data:text/html,fixture', 'file:///untrusted/index.html', 'not a URL', '',
  ])('rejects untrusted URL %s on the otherwise valid main window', url => {
    const f = fixture();
    f.frame.url = url;
    expect(() => f.invoke()).toThrow('IPC 来源校验失败');
    expect(f.listener).not.toHaveBeenCalled();
  });

  it('rechecks trust after window replacement and dev-to-file fallback, accepting normal hash routes', () => {
    const f = fixture();
    expect(f.invoke('dev')).toEqual(['dev']);
    const replacement = { ...f.contents };
    f.context.window = { ...f.window, webContents: replacement };
    expect(() => f.invoke()).toThrow('IPC 来源校验失败');
    f.event.sender = replacement;
    expect(f.invoke('new window')).toEqual(['new window']);
    const entry = path.resolve('dist/中文 空格/index.html');
    f.context.renderer = createTrustedFileRenderer(entry);
    expect(() => f.invoke()).toThrow('IPC 来源校验失败');
    f.frame.url = `${pathToFileURL(entry)}#/projects/example`;
    expect(f.invoke('packaged')).toEqual(['packaged']);
    f.frame.url = `${pathToFileURL(path.join(path.dirname(entry), 'other.html'))}#/overview`;
    expect(() => f.invoke()).toThrow('IPC 来源校验失败');
  });
});
