import type { ProcessStatus, RunSessionDto, RunnerExecutionMode } from '@codehelm/contracts';
import { getProfileProcessStatus } from './service-endpoints.js';

/** Presentation only: historical IDs, PIDs and ports must never feed live controls. */
export function getProfilePresentation(
  projectId: string,
  profileId: string | undefined,
  active: readonly RunSessionDto[],
  history: readonly RunSessionDto[],
  live: ReadonlyMap<string, { status: ProcessStatus; runSessionId?: string; projectId?: string }>,
  stateKnown: boolean,

  profileServiceIds: readonly string[] = [],
) {
  const matches = (s: RunSessionDto) => s.projectId === projectId && s.runProfileId === profileId;
  const current = active.find(matches);
  const previous = history.filter(matches).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const session = current ?? previous;
  const historical = !current && !!previous;
  const statuses = new Map<string, ProcessStatus>();
  if (!stateKnown) return { status: 'UNKNOWN', historical: false, statuses };

  // Startup IPC resolves only after readiness. Live events can precede its first
  // active-session snapshot; do not mislabel them as IDLE or as the previous run.
  if (!current) {
    const recordedIds = new Set(history.map(s => s.id));
    const pending = [...live].filter(([id, value]) => profileServiceIds.includes(id)
      && value.projectId === projectId && value.runSessionId && !recordedIds.has(value.runSessionId));
    const pendingId = pending.find(([, s]) => ['STARTING', 'RUNNING', 'STOPPING', 'DEGRADED'].includes(s.status))?.[1].runSessionId
      ?? pending[0]?.[1].runSessionId;
    if (pendingId) {
      const group = new Map(pending.filter(([, value]) => value.runSessionId === pendingId));
      for (const [id, value] of group) statuses.set(id, value.status);
      const aggregate = getProfileProcessStatus([...group.keys()].map(id => ({ id })), group);
      const hasActive = [...group.values()].some(s => ['STARTING', 'RUNNING', 'STOPPING', 'DEGRADED'].includes(s.status));
      return { status: aggregate === 'FAILED' && hasActive ? 'PARTIAL_FAILED' : aggregate, historical: false, statuses };
    }
  }
  if (!session) return { status: 'IDLE', historical: false, statuses };
  for (const service of session.services) {
    const update = current ? live.get(service.serviceConfigId) : undefined;
    statuses.set(service.serviceConfigId, update?.runSessionId === session.id ? update.status : service.status);
  }
  if (historical) return { status: session.status, historical, statuses };
  const aggregate = getProfileProcessStatus([...statuses.keys()].map(id => ({ id })),
    new Map([...statuses].map(([id, status]) => [id, { status }])));
  const hasActive = [...statuses.values()].some(s => ['STARTING', 'RUNNING', 'STOPPING', 'DEGRADED'].includes(s));
  const failed = aggregate === 'FAILED' || session.status === 'PARTIAL_FAILED' || session.status === 'FAILED';
  const status = session.status === 'STOPPING' ? 'STOPPING'
    : failed ? (hasActive ? 'PARTIAL_FAILED' : 'FAILED')
      : aggregate === 'IDLE' ? session.status : aggregate;
  return { status, historical, statuses };
}

export function failurePolicyLabel(policy: string): string {
  switch (policy) {
    case 'block_dependents': return '阻断依赖它的下游服务';
    case 'continue': return '允许下游继续启动';
    case 'rollback_all': return '任一服务失败时回滚全部服务';
    default: return '未知策略';
  }
}

export function getLaunchFeedback(session: RunSessionDto | null, mode: RunnerExecutionMode) {
  if (!session) return { level: 'warning' as const, text: '未获取到启动结果，请刷新运行记录确认。' };
  if (session.status === 'PARTIAL_FAILED') {
    return { level: 'warning' as const, text: '方案部分失败，仍有服务运行，请查看失败记录和日志。' };
  }
  if (session.status === 'FAILED' || session.services.some(s => s.status === 'FAILED' || s.status === 'DEGRADED')) {
    return { level: 'error' as const, text: '方案启动失败，请查看服务状态和日志。' };
  }
  if (session.status === 'RUNNING' && session.services.length > 0 && session.services.every(s => s.status === 'RUNNING')) {
    return { level: 'success' as const, text: mode === 'install' ? '依赖准备完毕，服务方案已启动。' : '服务方案已启动。' };
  }
  return { level: 'info' as const, text: '启动流程已返回，请按当前运行状态确认结果。' };
}
