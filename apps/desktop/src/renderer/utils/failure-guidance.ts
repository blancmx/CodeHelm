import type { ServiceSessionDto } from '@codehelm/contracts';

/** Fixed advice only; raw stored errors remain separately visible in run history. */
export function failureGuidance(service: Pick<ServiceSessionDto, 'status' | 'errorMessage' | 'exitCode'>): string | null {
  if (service.errorMessage?.includes('重启前环境检查未通过')) return '原服务已经停止；修复环境问题后重新启动方案，不会自动重试。';
  if (!['FAILED', 'DEGRADED', 'ORPHANED'].includes(service.status)) return null;
  const reason = service.errorMessage ?? '';
  if (service.status === 'ORPHANED') return '进程归属尚未确认，请查看核验记录；不要直接结束未知进程。';
  if (/ENOENT|not found|不存在|找不到/i.test(reason)) return '运行文件或命令可能缺失：先检查运行环境，再核对服务命令与工作目录。';
  if (/EADDRINUSE|端口.*(?:占用|冲突|绑定)/i.test(reason)) return '核对服务端口，改用可用端口或手动处理已知占用；应用不会结束外部进程。';
  if (/就绪|健康检查|timed?\s*out|timeout/i.test(reason)) return '检查服务日志、健康检查地址和端口；确认服务确实启动后，再调整就绪等待时间。';
  if (service.exitCode !== undefined && service.exitCode !== 0) return '服务提前退出：查看同一运行记录的退出码和日志，修复程序或配置后重试。';
  return '先检查运行环境，再结合这次运行的原始错误和日志核对配置；依赖缺失时可使用受控安装预览。';
}
