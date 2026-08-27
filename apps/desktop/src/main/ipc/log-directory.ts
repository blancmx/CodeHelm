import path from 'node:path';

interface LogDirectoryContext {
  isPackaged: boolean;
  appPath: string;
  executablePath: string;
}

/** Keep runtime logs beside CodeHelm, independently of the launch working directory. */
export function resolveLogDirectory(context: LogDirectoryContext): string {
  // Development appPath is <CodeHelm repository>/apps/desktop.
  // Packaged appPath may point into resources/app.asar, which must not contain logs.
  const codeHelmDirectory = context.isPackaged
    ? path.dirname(context.executablePath)
    : path.resolve(context.appPath, '..', '..');
  return path.join(codeHelmDirectory, 'logs');
}
