import { describe, expect, it } from 'vitest';
import { displayIpcError } from '../ipc-error.js';

describe('IPC display errors', () => {
  it.each([
    [new Error("Error invoking remote method 'codehelm:runner:reuse-execution-approval': Error: 请人工核验遗留进程。"), '请人工核验遗留进程。'],
    [new Error('Error invoking remote method "codehelm:runner:start": Error: Execution confirmation cancelled.'), 'Execution confirmation cancelled.'],
    [new Error("Error invoking remote method 'codehelm:runner:start': Error: Error invoking remote method 'codehelm:profiles:save': Error: 数据库不可用"), '数据库不可用'],
    [new Error('磁盘空间不足：无法保存记录'), '磁盘空间不足：无法保存记录'],
    ['Error: ordinary diagnostic', 'Error: ordinary diagnostic'],
    [new Error("Error invoking remote method 'other:api': Error: forbidden"), "Error invoking remote method 'other:api': Error: forbidden"],
    [new Error(''), '启动失败'],
    [undefined, '启动失败'],
  ])('keeps the actual reason for %s', (error, expected) => {
    expect(displayIpcError(error, '启动失败')).toBe(expected);
  });
});
