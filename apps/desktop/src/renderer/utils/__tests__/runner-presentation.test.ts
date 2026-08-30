import { describe, expect, it } from 'vitest';
import type { RunSessionDto } from '@codehelm/contracts';
import { failurePolicyLabel, getLaunchFeedback, getProfilePresentation } from '../runner-presentation.js';
import { getServiceEndpoints } from '../service-endpoints.js';

const run: RunSessionDto = { id: 'run', projectId: 'project', runProfileId: 'profile', status: 'PARTIAL_FAILED', startedAt: '2026-08-28T00:00:00Z', services: [
  { id: 'failed-a', runSessionId: 'run', serviceConfigId: 'a', serviceName: 'A', serviceType: 'tool', status: 'FAILED', exitCode: 7 },
  { id: 'live-d', runSessionId: 'run', serviceConfigId: 'd', serviceName: 'D', serviceType: 'backend', status: 'RUNNING', port: 5180 },
] };

describe('runner result presentation', () => {
  it('shows new live startup events before IPC returns, rather than IDLE or older history', () => {
    const live = new Map([
      ['a', { status: 'STARTING' as const, runSessionId: 'new', projectId: 'project' }],
      ['d', { status: 'RUNNING' as const, runSessionId: 'new', projectId: 'project' }],
      ['foreign', { status: 'FAILED' as const, runSessionId: 'other', projectId: 'project' }],
    ]);
    const result = getProfilePresentation('project', 'profile', [], [run], live, true, ['a', 'd']);
    expect(result.status).toBe('STARTING');
    expect(result.historical).toBe(false);
    expect([...result.statuses]).toEqual([['a', 'STARTING'], ['d', 'RUNNING']]);
  });
  it('does not revive a recorded run or another project from delayed events', () => {
    const live = new Map([
      ['a', { status: 'RUNNING' as const, runSessionId: 'run', projectId: 'project' }],
      ['d', { status: 'RUNNING' as const, runSessionId: 'foreign', projectId: 'other' }],
    ]);
    const result = getProfilePresentation('project', 'profile', [], [run], live, true, ['a', 'd']);
    expect(result.historical).toBe(true);
    expect(result.statuses.get('a')).toBe('FAILED');
  });
  it('shows partial failure and individual failure from a refreshed complete active snapshot', () => {
    const result = getProfilePresentation('project', 'profile', [run], [], new Map(), true);
    expect(result.status).toBe('PARTIAL_FAILED');
    expect(result.historical).toBe(false);
    expect([...result.statuses]).toEqual([['a', 'FAILED'], ['d', 'RUNNING']]);
  });
  it('prefers current run events without accepting a different run with reused config IDs', () => {
    const result = getProfilePresentation('project', 'profile', [run], [], new Map([
      ['a', { status: 'RUNNING', runSessionId: 'old' }], ['d', { status: 'STOPPED', runSessionId: 'run' }],
    ]), true);
    expect(result.status).toBe('FAILED');
    expect([...result.statuses.values()]).toEqual(['FAILED', 'STOPPED']);
  });
  it('keeps a rollback failure as explicitly historical, with no control or endpoint data', () => {
    const stopped = { ...run, status: 'FAILED' as const, services: run.services.map(s => s.serviceConfigId === 'd' ? { ...s, status: 'STOPPED' as const } : s) };
    const result = getProfilePresentation('project', 'profile', [], [stopped], new Map(), true);
    expect(result).toMatchObject({ status: 'FAILED', historical: true });
    expect([...result.statuses.values()]).toEqual(['FAILED', 'STOPPED']);
    expect(getServiceEndpoints([{ id: 'd', name: 'D', type: 'backend' }], new Map())).toEqual([]);
  });
  it('uses only the selected project/profile and newest history, even if history is unsorted', () => {
    const newer = { ...run, id: 'new', status: 'STOPPED' as const, startedAt: '2026-08-29T00:00:00Z' };
    expect(getProfilePresentation('project', 'profile', [{ ...run, projectId: 'other' }], [run, newer], new Map(), true).status).toBe('STOPPED');
    expect(getProfilePresentation('project', 'other', [run], [run], new Map(), true).status).toBe('IDLE');
  });
  it('does not disguise unreadable runtime state as stopped or healthy', () => {
    const result = getProfilePresentation('project', 'profile', [run], [run], new Map(), false);
    expect(result).toEqual({ status: 'UNKNOWN', historical: false, statuses: new Map() });
  });
  it.each(['STARTING', 'STOPPING'] as const)('preserves an empty %s session', status => {
    expect(getProfilePresentation('project', 'profile', [{ ...run, status, services: [] }], [], new Map(), true).status).toBe(status);
  });
  it.each(['start', 'install'] as const)('does not show a success toast for partial or rolled-back %s', mode => {
    expect(getLaunchFeedback(run, mode).level).toBe('warning');
    expect(getLaunchFeedback({ ...run, status: 'FAILED' }, mode).level).toBe('error');
  });
  it('requires running children as well as a running session before success', () => {
    expect(getLaunchFeedback({ ...run, status: 'RUNNING' }, 'start').level).toBe('error');
    expect(getLaunchFeedback({ ...run, status: 'RUNNING', services: [] }, 'start').level).toBe('info');
    expect(getLaunchFeedback({ ...run, status: 'RUNNING', services: [run.services[1]] }, 'install').level).toBe('success');
    expect(getLaunchFeedback(null, 'start').level).toBe('warning');
  });
  it.each([
    ['block_dependents', '阻断依赖它的下游服务'], ['continue', '允许下游继续启动'],
    ['rollback_all', '任一服务失败时回滚全部服务'], ['unexpected', '未知策略'],
  ])('maps failure policy %s explicitly', (policy, label) => expect(failurePolicyLabel(policy)).toBe(label));
});
