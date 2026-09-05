export interface DatabaseBackupDialogOptions {
  type: 'error' | 'warning';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

export function describeDatabaseError(error: unknown): string {
  if (!(error instanceof Error)) return '数据库初始化失败。';
  const cause = error.cause instanceof Error ? `\n原因：${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

export function createStartupDatabaseErrorDialog(
  error: unknown,
  databasePath: string,
  backupDirectory: string,
): DatabaseBackupDialogOptions {
  return {
    type: 'error',
    title: 'CodeHelm 数据库保护',
    message: '无法安全打开项目数据库',
    detail: `${describeDatabaseError(error)}\n\n数据库：${databasePath}\n备份目录：${backupDirectory}\n\n请保留上述文件。退出后检查磁盘空间和权限，或联系维护者核验备份；不要删除数据库或覆盖原文件。`,
    buttons: ['退出应用'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function createPeriodicDatabaseBackupWarning(
  error: unknown,
  backupDirectory: string,
): DatabaseBackupDialogOptions {
  return {
    type: 'warning',
    title: 'CodeHelm 数据库备份',
    message: '运行中数据库备份未完成',
    detail: `${describeDatabaseError(error)}\n\n备份目录：${backupDirectory}\n\n应用仍在运行。请检查磁盘空间、目录权限或文件占用；不要删除主数据库或覆盖现有备份。`,
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function createDatabaseBackupRetentionWarning(
  retainedBackups: number,
  retainedBytes: number,
  maxBackups: number,
  maxTotalBytes: number,
  backupDirectory: string,
): DatabaseBackupDialogOptions {
  return {
    type: 'warning',
    title: 'CodeHelm 数据库备份',
    message: '数据库备份保留量超过设定上限',
    detail: `为避免删除到安全恢复点下限，本次清理后仍保留 ${retainedBackups} 个备份、${retainedBytes} 字节；设定上限为 ${maxBackups} 个、${maxTotalBytes} 字节。\n\n备份目录：${backupDirectory}\n\n本次新备份已经校验，应用仍在运行。请人工核对并归档旧备份；不要直接删除主数据库或未知恢复文件。`,
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
