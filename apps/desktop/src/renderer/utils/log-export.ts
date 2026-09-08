import type { LogEntryDto } from '@codehelm/contracts';
export function formatLoadedLogExport(entries: LogEntryDto[], scope: Record<string, unknown>): string {
  return '# CodeHelm：当前已加载且符合筛选的日志；不是完整会话日志\n'
    + '# 查询范围 ' + JSON.stringify(scope) + '\n'
    + '# 条数 ' + entries.length + '\n'
    + entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
}
export function downloadLoadedLogs(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
