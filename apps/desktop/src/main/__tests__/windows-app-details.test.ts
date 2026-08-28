import { describe, expect, it } from 'vitest';
import { createWindowsAppDetails } from '../windows-app-details.js';

describe('Windows taskbar identity', () => {
  it('relaunches the development app with its absolute entry and branded icon', () => {
    const details = createWindowsAppDetails({
      executablePath: 'C:\\Dev Tools\\electron.exe', appPath: 'E:\\工程 项目\\CodeHelm',
      iconPath: 'E:\\工程 项目\\CodeHelm\\resources\\icon.ico', isPackaged: false,
    });
    expect(details).toEqual({
      appId: 'com.codehelm.desktop', appIconIndex: 0,
      appIconPath: 'E:\\工程 项目\\CodeHelm\\resources\\icon.ico',
      relaunchDisplayName: 'CodeHelm',
      relaunchCommand: '"C:\\Dev Tools\\electron.exe" "E:\\工程 项目\\CodeHelm"',
    });
  });

  it('relaunches a packaged executable without treating app.asar as an argument', () => {
    const details = createWindowsAppDetails({
      executablePath: 'C:\\Program Files\\CodeHelm\\CodeHelm.exe',
      appPath: 'C:\\Program Files\\CodeHelm\\resources\\app.asar',
      iconPath: '', isPackaged: true,
    });
    expect(details.relaunchCommand).toBe('"C:\\Program Files\\CodeHelm\\CodeHelm.exe"');
    expect(details.appIconPath).toBe('C:\\Program Files\\CodeHelm\\CodeHelm.exe');
  });

  it('preserves trailing directory separators inside quoted Windows arguments', () => {
    const details = createWindowsAppDetails({
      executablePath: 'C:\\electron.exe', appPath: 'E:\\Code Helm\\', iconPath: '', isPackaged: false,
    });
    expect(details.relaunchCommand).toBe('"C:\\electron.exe" "E:\\Code Helm\\\\"');
  });
});
