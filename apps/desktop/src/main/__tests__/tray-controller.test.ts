import { beforeEach, expect, it, vi } from 'vitest';
import { TrayController } from '../tray-controller.js';

const state = vi.hoisted(() => ({
  empty: false, failMenu: false,
  trays: [] as { destroyed: boolean; events: Map<string, () => void>; menu: any[] }[],
}));
vi.mock('electron', () => ({
  nativeImage: { createFromPath: () => ({ isEmpty: () => state.empty }) },
  Menu: { buildFromTemplate: (items: any[]) => items },
  Tray: class {
    destroyed = false;
    events = new Map<string, () => void>();
    menu: any[] = [];
    constructor() { state.trays.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    setToolTip() {}
    setContextMenu(menu: any[]) {
      if (state.failMenu) throw new Error('tray unavailable');
      this.menu = menu;
    }
    on(event: string, callback: () => void) { this.events.set(event, callback); }
  },
}));
beforeEach(() => { state.empty = false; state.failMenu = false; state.trays = []; });
function setup() {
  const actions = { iconPath: 'icon.ico', showWindow: vi.fn(), showRunner: vi.fn(), quit: vi.fn() };
  return { actions, controller: new TrayController(actions) };
}
it('defaults off and reuses one tray across repeated enable requests', () => {
  const { controller } = setup();
  expect(controller.enabled).toBe(false);
  controller.setEnabled(true); controller.setEnabled(true);
  expect(controller.enabled).toBe(true);
  expect(state.trays).toHaveLength(1);
});
it('routes click and menu actions to restore, run state and managed quit', () => {
  const { controller, actions } = setup(); controller.setEnabled(true);
  const tray = state.trays[0];
  tray.events.get('click')!(); tray.events.get('double-click')!();
  tray.menu[0].click(); tray.menu[1].click(); tray.menu[3].click();
  expect(actions.showWindow).toHaveBeenCalledTimes(3);
  expect(actions.showRunner).toHaveBeenCalledOnce();
  expect(actions.quit).toHaveBeenCalledOnce();
});
it('restores the window before removing its tray and releases tray on quit', () => {
  const { controller, actions } = setup(); controller.setEnabled(true);
  actions.showWindow.mockImplementation(() => expect(state.trays[0].destroyed).toBe(false));
  controller.setEnabled(false);
  expect(controller.enabled).toBe(false); expect(actions.showWindow).toHaveBeenCalledOnce();
  controller.setEnabled(true); controller.dispose(); controller.dispose();
  expect(state.trays.every(tray => tray.destroyed)).toBe(true);
  expect(() => controller.setEnabled(true)).toThrow('正在退出');
});
it('keeps close-to-tray disabled on missing icon or native setup failure', () => {
  const { controller } = setup(); state.empty = true;
  expect(() => controller.setEnabled(true)).toThrow('图标');
  expect(controller.enabled).toBe(false); expect(state.trays).toHaveLength(0);
  state.empty = false; state.failMenu = true;
  expect(() => controller.setEnabled(true)).toThrow('tray unavailable');
  expect(controller.enabled).toBe(false); expect(state.trays[0].destroyed).toBe(true);
});
