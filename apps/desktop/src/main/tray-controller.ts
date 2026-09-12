import { Menu, Tray, nativeImage } from 'electron';

/** Own exactly one native tray; hiding is permitted only while it exists. */
export class TrayController {
  private tray: Tray | undefined;
  private disposed = false;

  constructor(private readonly options: {
    iconPath: string;
    showWindow: () => void;
    showRunner: () => void;
    quit: () => void;
  }) {}

  get enabled(): boolean { return !!this.tray && !this.tray.isDestroyed(); }

  setEnabled(enabled: boolean): void {
    if (this.disposed) throw new Error('应用正在退出，无法修改托盘设置。');
    if (!enabled) {
      // Never remove the only way to recover a hidden window.
      if (this.enabled) this.options.showWindow();
      this.tray?.destroy();
      this.tray = undefined;
      return;
    }
    if (this.enabled) return;
    const icon = nativeImage.createFromPath(this.options.iconPath);
    if (icon.isEmpty()) throw new Error('无法加载托盘图标，仍保持关闭窗口退出。');
    const tray = new Tray(icon);
    try {
      tray.setToolTip('CodeHelm · 关闭窗口后服务继续运行');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示窗口', click: this.options.showWindow },
        { label: '查看运行状态', click: this.options.showRunner },
        { type: 'separator' },
        { label: '退出 CodeHelm', click: this.options.quit },
      ]));
      tray.on('click', this.options.showWindow);
      tray.on('double-click', this.options.showWindow);
      this.tray = tray;
    } catch (error) { tray.destroy(); throw error; }
  }

  dispose(): void {
    this.disposed = true;
    this.tray?.destroy();
    this.tray = undefined;
  }
}
