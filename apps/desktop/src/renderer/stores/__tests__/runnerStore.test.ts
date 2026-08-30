import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { DEFAULT_MAX_LOG_BUFFER_BYTES, DEFAULT_MAX_LOG_ENTRY_BYTES, utf8ByteLength } from '@codehelm/domain';
import type { RunSessionDto, ServiceStatusEventDto } from '@codehelm/contracts';
import {
  appendBoundedLogs,
  mergeRunSessionStatuses,
  mergeServiceStatus,
  type RunnerServiceStatus,
  useRunnerStore,
} from '../runnerStore.js';
import { useProjectStore } from '../projectStore.js';

afterEach(() => vi.unstubAllGlobals());

describe('authoritative runner state', () => {
  it.each(['startProfile', 'installAndStartProfile'] as const)('refreshes persisted rollback history when %s rejects', async method => {
    setActivePinia(createPinia());
    const failed = { ...session('a'), status: 'FAILED', services: [{ ...session('a').services[0], status: 'FAILED' }] };
    const getState = vi.fn().mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [failed] });
    const reject = vi.fn().mockRejectedValue(new Error('readiness failed'));
    vi.stubGlobal('window', { codehelm: { runner: { getState, start: reject, installAndStart: reject, onStatus: vi.fn(), onLogs: vi.fn() } } });
    const store = useRunnerStore();
    await expect(store[method]('profile', 'approved')).rejects.toThrow('readiness failed');
    expect(getState).toHaveBeenCalledTimes(2); // Initial subscription and the rejected launch's finally.
    expect(store.history[0]).toEqual(failed);
    expect(store.serviceStatuses.size).toBe(0);
  });
  it('uses one confirmation on first launch and reuses approval without another dialog', async () => {
    setActivePinia(createPinia());
    const session = { id: 'run', projectId: 'project', runProfileId: 'profile', services: [] };
    const confirmExecution = vi.fn().mockResolvedValue('confirmed');
    const reuseExecutionApproval = vi.fn().mockRejectedValueOnce(new Error('Execution confirmation required'))
      .mockResolvedValue('reused');
    const start = vi.fn().mockResolvedValue(session);
    vi.stubGlobal('window', { codehelm: { runner: { confirmExecution, reuseExecutionApproval, start,
      getState: vi.fn().mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [] }), onStatus: vi.fn(), onLogs: vi.fn(),
    } } });
    const store = useRunnerStore();
    await store.launchProfile('profile', 'start', 'light');
    await store.launchProfile('profile', 'start', 'light');
    expect(confirmExecution).toHaveBeenCalledExactlyOnceWith('profile', 'start', 'light');
    expect(start.mock.calls).toEqual([['profile', 'confirmed'], ['profile', 'reused']]);
  });

  it.each(['Execution confirmation cancelled.', 'database unavailable'])('does not launch when approval fails: %s', async error => {
    setActivePinia(createPinia());
    const confirmExecution = vi.fn().mockRejectedValue(new Error(error));
    const start = vi.fn();
    vi.stubGlobal('window', { codehelm: { runner: { confirmExecution, start,
      reuseExecutionApproval: vi.fn().mockRejectedValue(new Error(
        error === 'database unavailable' ? error : 'Execution confirmation required')),
    } } });
    await expect(useRunnerStore().launchProfile('profile', 'start', 'dark')).rejects.toThrow(error);
    expect(start).not.toHaveBeenCalled();
    expect(confirmExecution).toHaveBeenCalledTimes(error === 'database unavailable' ? 0 : 1);
  });

  it('refreshes persisted failure state even when a restart IPC rejects', async () => {
    setActivePinia(createPinia());
    const getState = vi.fn().mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [] });
    vi.stubGlobal('window', { codehelm: { runner: { getState,
      restartService: vi.fn().mockRejectedValue(new Error('restart not ready')),
    } } });
    const store = useRunnerStore();
    await expect(store.restartService('old-child')).rejects.toThrow('restart not ready');
    expect(getState).toHaveBeenCalledOnce();
    expect(store.stateLoaded).toBe(true);
  });
  function session(id: string): RunSessionDto {
    return { id, projectId: id, runProfileId: id, status: 'RUNNING', startedAt: '', services: [{
      id: 'child-' + id, runSessionId: id, serviceConfigId: 'config-' + id, serviceName: id, serviceType: 'tool', status: 'RUNNING',
    }] };
  }
  it('does not hydrate historical PID controls, and stopping one session preserves the other', async () => {
    setActivePinia(createPinia());
    const getState = vi.fn().mockResolvedValue({ activeSessions: [session('a'), session('b')], unresolvedSessions: [], history: [session('history')] });
    vi.stubGlobal('window', { codehelm: { runner: { getState, stopSession: vi.fn() } } });
    const store = useRunnerStore();
    await store.fetchState();
    expect(store.serviceStatuses.size).toBe(2);
    expect(store.serviceStatuses.has('config-history')).toBe(false);
    getState.mockResolvedValue({ activeSessions: [session('b')], unresolvedSessions: [], history: [session('a'), session('history')] });
    await store.stopSession('a');
    expect([...store.serviceStatuses.keys()]).toEqual(['config-b']);
    getState.mockRejectedValue(new Error('database unavailable'));
    expect(await store.fetchState()).toBe(false);
    expect(store.stateError).toBe('database unavailable');
    expect(store.serviceStatuses.get('config-b')?.status).toBe('RUNNING');
  });

  it('ignores a stale snapshot if a newer live event arrived during the read', async () => {
    setActivePinia(createPinia());
    let emit!: (data: ServiceStatusEventDto) => void;
    let complete!: (value: unknown) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    vi.stubGlobal('window', { codehelm: { runner: {
      getState: () => pending, onStatus: (listener: typeof emit) => { emit = listener; }, onLogs: vi.fn(),
    } } });
    const store = useRunnerStore();
    store.setupListeners();
    const reading = store.fetchState();
    emit(event('RUNNING'));
    complete({ activeSessions: [], unresolvedSessions: [session('stale')], history: [] });
    expect(await reading).toBe(false);
    expect(store.serviceStatuses.get('service-config')?.status).toBe('RUNNING');
    expect(store.unresolvedSessions).toEqual([]);
  });

  it('retains failed siblings across refresh and drops all live controls once the run becomes history', async () => {
    setActivePinia(createPinia());
    const run: RunSessionDto = { ...session('a'), status: 'PARTIAL_FAILED', services: [
      { ...session('a').services[0], status: 'FAILED', exitCode: 7 },
      { ...session('a').services[0], id: 'child-d', serviceConfigId: 'config-d', status: 'RUNNING', port: 5180 },
    ] };
    const getState = vi.fn().mockResolvedValue({ activeSessions: [run], unresolvedSessions: [], history: [] });
    vi.stubGlobal('window', { codehelm: { runner: { getState } } });
    const store = useRunnerStore();
    await store.fetchState();
    await store.fetchState();
    expect(store.serviceStatuses.get('config-a')?.status).toBe('FAILED');
    expect(store.runningCount).toBe(1);
    getState.mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [{ ...run, status: 'FAILED' }] });
    await store.fetchState();
    expect(store.serviceStatuses.size).toBe(0);
    expect(store.history[0].services[0].status).toBe('FAILED');
  });

  it('keeps all unresolved notices separate from live controls, across failure and resolution', async () => {
    setActivePinia(createPinia());
    const live = session('a');
    const old = (id: string): RunSessionDto => ({ ...session(id), projectId: 'a', status: 'INTERRUPTED',
      services: [{ ...live.services[0], id: 'old-' + id, status: 'ORPHANED', pid: 999,
        recovery: { outcome: 'unverified', checkedAt: '2026-08-28T00:00:00Z' } }],
    });
    const oldA = old('old-profile-a');
    const oldB = old('old-profile-b');
    const getState = vi.fn().mockResolvedValue({ activeSessions: [live], unresolvedSessions: [oldA, oldB], history: [oldA] });
    vi.stubGlobal('window', { codehelm: { runner: { getState } } });
    const store = useRunnerStore();
    await store.fetchState();
    expect(store.getUnresolvedCount('a')).toBe(2);
    expect(store.getUnresolvedCount('other-project')).toBe(0);
    expect(store.displayHistory.map(item => item.id)).toEqual([oldA.id, oldB.id]);
    expect(store.runningCount).toBe(1);
    expect(store.serviceStatuses.get('config-a')).toMatchObject({ status: 'RUNNING', runSessionId: 'a' });
    expect(store.serviceStatuses.get('config-a')?.pid).toBeUndefined();

    getState.mockRejectedValue(new Error("Error invoking remote method 'codehelm:runner:get-state': Error: 记录读取失败"));
    await store.fetchState();
    expect(store.stateError).toBe('记录读取失败');
    expect(store.getUnresolvedCount('a')).toBe(2);
    expect(store.getProjectState('a').status).toBe('UNKNOWN');

    getState.mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [{ ...oldA, services: [{ ...oldA.services[0], status: 'STOPPED' }] }] });
    await store.fetchState();
    expect(store.getUnresolvedCount('a')).toBe(0);
    expect(store.serviceStatuses.size).toBe(0);
    expect(store.stateError).toBeNull();
    expect(store.displayHistory[0].status).toBe('INTERRUPTED');
  });
});

function event(status: ServiceStatusEventDto['status']): ServiceStatusEventDto {
  return {
    projectId: 'project',
    runSessionId: 'run',
    serviceSessionId: 'session-service',
    serviceConfigId: 'service-config',
    serviceName: 'Web',
    status,
    pid: 1234,
    port: 5180,
  };
}

describe('overview project runtime state', () => {
  async function setup() {
    setActivePinia(createPinia());
    let emit!: (data: ServiceStatusEventDto) => void;
    const getState = vi.fn().mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [] });
    vi.stubGlobal('window', { codehelm: { runner: { getState,
      onStatus: (listener: typeof emit) => { emit = listener; }, onLogs: vi.fn(),
    } } });
    const store = useRunnerStore();
    store.setupListeners();
    await store.fetchState();
    return { store, getState, emit: (data: ServiceStatusEventDto) => emit(data) };
  }

  it('updates cards and filters from events without mutating project history', async () => {
    const { store, emit } = await setup();
    const projects = useProjectStore();
    projects.projects = [{ id: 'project', name: 'Fixture', rootPath: '/fixture', tags: [],
      primaryLanguages: [], primaryFrameworks: [], moduleCount: 1, serviceCount: 1, lastRunStatus: 'STOPPED' }];
    const cards = computed(() => projects.projects.map(p => ({ ...p, runtime: store.getProjectState(p.id) })));
    const filtered = computed(() => cards.value.filter(p => p.runtime.runningCount > 0));
    expect(cards.value[0].runtime.status).toBe('STOPPED');
    for (const status of ['STARTING', 'RUNNING', 'STOPPING', 'STOPPED'] as const) {
      emit(event(status));
      const active = status === 'STARTING' || status === 'RUNNING' ? 1 : 0;
      expect(cards.value[0].runtime).toEqual({ status, runningCount: active });
      expect(filtered.value).toHaveLength(active);
      expect(store.runningCount).toBe(active);
      expect(projects.projects[0].lastRunStatus).toBe('STOPPED');
    }
  });

  it('separates projects and counts services across multiple profiles', async () => {
    const { store, emit } = await setup();
    emit(event('RUNNING'));
    emit({ ...event('RUNNING'), serviceConfigId: 'second', serviceSessionId: 'second', runSessionId: 'other-profile' });
    emit({ ...event('STARTING'), projectId: 'other-project', serviceConfigId: 'third', serviceSessionId: 'third' });
    expect(store.getProjectState('project')).toEqual({ status: 'RUNNING', runningCount: 2 });
    expect(store.getProjectState('other-project')).toEqual({ status: 'STARTING', runningCount: 1 });
    expect(store.runningCount).toBe(3);
    emit(event('STOPPED'));
    expect(store.getProjectState('project')).toEqual({ status: 'RUNNING', runningCount: 1 });
    expect(store.getProjectState('other-project').runningCount).toBe(1);
  });

  it('does not use historical RUNNING records as current state', async () => {
    const { store, getState } = await setup();
    getState.mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [{ id: 'old', projectId: 'project',
      status: 'RUNNING', services: [{ serviceConfigId: 'service-config', status: 'RUNNING', pid: 1234 }] }] });
    await store.fetchState();
    expect(store.getProjectState('project')).toEqual({ status: 'STOPPED', runningCount: 0 });
    expect(store.runningCount).toBe(0);
  });

  it('shows unknown before loading or after a failed read, then recovers on retry', async () => {
    const { store, getState, emit } = await setup();
    store.stateLoaded = false;
    expect(store.getProjectState('project').status).toBe('UNKNOWN');
    await store.fetchState();
    emit(event('RUNNING'));
    getState.mockRejectedValueOnce(new Error('runtime unavailable'));
    expect(await store.fetchState()).toBe(false);
    expect(store.getProjectState('project')).toEqual({ status: 'UNKNOWN', runningCount: 0 });
    await store.fetchState();
    expect(store.getProjectState('project')).toEqual({ status: 'STOPPED', runningCount: 0 });
  });

  it('shows a pending empty session without inventing a running service or hiding newer events', async () => {
    const { store, getState, emit } = await setup();
    getState.mockResolvedValue({ activeSessions: [{ id: 'run', projectId: 'project',
      status: 'STARTING', services: [] }], unresolvedSessions: [], history: [] });
    await store.fetchState();
    expect(store.getProjectState('project')).toEqual({ status: 'STARTING', runningCount: 0 });
    expect(store.runningCount).toBe(0);
    emit(event('RUNNING'));
    expect(store.getProjectState('project')).toEqual({ status: 'RUNNING', runningCount: 1 });
  });

  it('retains snapshot partial failure when failed children are excluded from live controls', async () => {
    const { store, getState } = await setup();
    getState.mockResolvedValue({ activeSessions: [{ id: 'run', projectId: 'project',
      status: 'PARTIAL_FAILED', services: [{ id: 'child', serviceConfigId: 'web', status: 'RUNNING' }] }], unresolvedSessions: [], history: [] });
    await store.fetchState();
    expect(store.getProjectState('project')).toEqual({ status: 'FAILED', runningCount: 1 });
    expect(store.runningCount).toBe(1);
    getState.mockResolvedValue({ activeSessions: [], unresolvedSessions: [], history: [] });
    await store.fetchState();
    expect(store.getProjectState('project')).toEqual({ status: 'STOPPED', runningCount: 0 });
  });

  it('preserves newer live project state when the refresh snapshot is stale', async () => {
    const { store, getState, emit } = await setup();
    let finish!: (value: unknown) => void;
    getState.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const reading = store.fetchState();
    emit(event('RUNNING'));
    finish({ activeSessions: [], unresolvedSessions: [], history: [] });
    expect(await reading).toBe(false);
    expect(store.getProjectState('project')).toEqual({ status: 'RUNNING', runningCount: 1 });
  });

  it.each(['FAILED', 'DEGRADED', 'ORPHANED', 'VERIFYING'] as const)(
    'keeps mixed %s visible while another service is running', async status => {
      const { store, emit } = await setup();
      emit(event('RUNNING'));
      emit({ ...event(status), serviceConfigId: 'other-config', serviceSessionId: 'other-child' });
      expect(store.getProjectState('project')).toEqual({ status, runningCount: 1 });
      expect(store.runningCount).toBe(1);
    },
  );
});

describe('runner service status merge', () => {
  it('keeps one entry when an older state contains config and session aliases', () => {
    const duplicated = new Map<string, RunnerServiceStatus>([
      ['service-config', { status: 'STARTING', sessionServiceId: 'session-service' }],
      ['session-service', { status: 'STARTING', sessionServiceId: 'session-service' }],
    ]);

    const result = mergeServiceStatus(duplicated, event('RUNNING'));

    expect([...result.keys()]).toEqual(['service-config']);
    expect(result.get('service-config')).toMatchObject({
      status: 'RUNNING',
      pid: 1234,
      port: 5180,
    });
  });

  it('hydrates service state when start returns an already-running session', () => {
    const session: RunSessionDto = {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      runProfileId: '00000000-0000-4000-8000-000000000003',
      status: 'RUNNING',
      startedAt: '2026-01-01T00:00:00.000Z',
      services: [{
        id: 'session-service',
        runSessionId: '00000000-0000-4000-8000-000000000001',
        serviceConfigId: 'service-config',
        serviceName: 'Web',
        serviceType: 'frontend',
        status: 'RUNNING',
        pid: 1234,
        port: 5173,
      }],
    };

    expect(mergeRunSessionStatuses(new Map(), session).get('service-config')).toMatchObject({
      status: 'RUNNING',
      port: 5173,
      sessionServiceId: 'session-service',
    });
  });
});

describe('runner log buffer bounds', () => {
  it('limits individual messages and aggregate renderer log bytes', () => {
    const entry = {
      id: 'log-1',
      serviceSessionId: 'session-service',
      serviceName: 'Web',
      stream: 'stdout' as const,
      message: '界'.repeat(DEFAULT_MAX_LOG_ENTRY_BYTES),
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    const result = appendBoundedLogs([], Array.from({ length: 100 }, (_, index) => ({
      ...entry,
      id: `log-${index}`,
    })));

    expect(result.every((item) => utf8ByteLength(item.message) <= DEFAULT_MAX_LOG_ENTRY_BYTES)).toBe(true);
    expect(result.reduce((total, item) => total + utf8ByteLength(item.message), 0))
      .toBeLessThanOrEqual(DEFAULT_MAX_LOG_BUFFER_BYTES);
  });
});
