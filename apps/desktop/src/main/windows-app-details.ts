import type { AppDetailsOptions } from 'electron';

export const APP_NAME = 'CodeHelm';
export const WINDOWS_APP_ID = 'com.codehelm.desktop';

// Windows parses this command directly, not through cmd.exe. Quote every argument,
// including trailing backslashes, so spaces in installation/workspace paths work.
export function quoteWindowsArgument(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

export function createWindowsAppDetails(options: {
  executablePath: string;
  appPath: string;
  isPackaged: boolean;
  iconPath: string;
}): AppDetailsOptions {
  // Development needs the app entry as well as electron.exe. Do not persist argv:
  // debug flags and one-off launch arguments do not belong in a pinned shortcut.
  const command = [options.executablePath];
  if (!options.isPackaged) command.push(options.appPath);
  return {
    appId: WINDOWS_APP_ID,
    appIconPath: options.iconPath || options.executablePath,
    appIconIndex: 0,
    relaunchDisplayName: APP_NAME,
    relaunchCommand: command.map(quoteWindowsArgument).join(' '),
  };
}
