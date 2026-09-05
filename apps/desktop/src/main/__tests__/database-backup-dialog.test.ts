import { describe, expect, it } from 'vitest';
import { DatabaseBackupCapacityError, DatabaseStartupError } from '@codehelm/database';
import {
  createDatabaseBackupRetentionWarning,
  createPeriodicDatabaseBackupWarning,
  createStartupDatabaseErrorDialog,
} from '../database-backup-dialog.js';

describe('database backup native dialog content', () => {
  it('shows precise capacity evidence and preserves both database locations on startup failure', () => {
    const capacity = new DatabaseBackupCapacityError(400n, 100n, 50n);
    const error = new DatabaseStartupError('backup', '无法完成经校验的数据库备份，已停止启动。', capacity);
    const options = createStartupDatabaseErrorDialog(error, 'C:\\isolated\\codehelm.sqlite', 'C:\\isolated\\backups');
    expect(options).toMatchObject({
      type: 'error',
      title: 'CodeHelm 数据库保护',
      message: '无法安全打开项目数据库',
      buttons: ['退出应用'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(options.detail).toContain('至少需要 400 字节，可用 100 字节');
    expect(options.detail).toContain('C:\\isolated\\codehelm.sqlite');
    expect(options.detail).toContain('C:\\isolated\\backups');
    expect(options.detail).toContain('不要删除数据库或覆盖原文件');
  });

  it('keeps the application running after a periodic failure and gives an actionable acknowledgement', () => {
    const options = createPeriodicDatabaseBackupWarning(
      new Error('EPERM: backup directory is read-only'),
      'C:\\isolated\\backups',
    );
    expect(options).toMatchObject({
      type: 'warning',
      message: '运行中数据库备份未完成',
      buttons: ['知道了'],
    });
    expect(options.detail).toContain('应用仍在运行');
    expect(options.detail).toContain('磁盘空间、目录权限或文件占用');
    expect(options.detail).toContain('不要删除主数据库或覆盖现有备份');
  });

  it('explains when the recovery-point floor keeps verified backups above the retention limit', () => {
    const options = createDatabaseBackupRetentionWarning(
      3,
      3_221_225_472,
      20,
      2_147_483_648,
      'C:\\isolated\\backups',
    );
    expect(options).toMatchObject({
      type: 'warning',
      message: '数据库备份保留量超过设定上限',
      buttons: ['知道了'],
      noLink: true,
    });
    expect(options.detail).toContain('仍保留 3 个备份、3221225472 字节');
    expect(options.detail).toContain('设定上限为 20 个、2147483648 字节');
    expect(options.detail).toContain('本次新备份已经校验，应用仍在运行');
    expect(options.detail).toContain('人工核对并归档旧备份');
  });
});
