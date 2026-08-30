import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getProfileProcessStatus } from '../utils/service-endpoints.js';
import { displayIpcError } from '../utils/ipc-error.js';
import {
  DEFAULT_MAX_LOG_BUFFER_BYTES,
  DEFAULT_MAX_LOG_BUFFER_ENTRIES,
  DEFAULT_MAX_LOG_ENTRY_BYTES,
  truncateUtf8,
  utf8ByteLength,
} from '@codehelm/domain';
import type {
  LogEntryDto,
  ProcessStatus,
  RunSessionDto,
  RunnerExecutionMode,
  ServiceStatusEventDto,
} from '@codehelm/contracts';

export interface RunnerServiceStatus {
  status: ProcessStatus;
  pid?: number;
  port?: number;
  sessionServiceId?: string;
  serviceName?: string;
  projectId?: string;
  runSessionId?: string;
}

export interface ProjectRuntimeState {
  status: ProcessStatus | 'UNKNOWN';
  runningCount: number;
}

export function mergeServiceStatus(
  current: Map<string, RunnerServiceStatus>,
  event: ServiceStatusEventDto
): Map<string, RunnerServiceStatus> {
  const next = new Map(current);
  for (const [key, value] of next.entries()) {
    if (key !== event.serviceConfigId && value.sessionServiceId === event.serviceSessionId) {
      next.delete(key);
    }
  }
  next.set(event.serviceConfigId, {
    status: event.status,
    pid: event.pid,
    port: event.port,
    sessionServiceId: event.serviceSessionId,
    serviceName: event.serviceName,
    projectId: event.projectId,
    runSessionId: event.runSessionId,
  });
  return next;
}

export function mergeRunSessionStatuses(
  current: Map<string, RunnerServiceStatus>,
  session: RunSessionDto
): Map<string, RunnerServiceStatus> {
  const next = new Map(current);
  for (const service of session.services) {
    next.set(service.serviceConfigId, {
      status: service.status,
      pid: service.pid,
      port: service.port,
      sessionServiceId: service.id,
      serviceName: service.serviceName,
      projectId: session.projectId,
      runSessionId: session.id,
    });
  }
  return next;
}

export function appendBoundedLogs(
  current: LogEntryDto[],
  incoming: LogEntryDto[]
): LogEntryDto[] {
  const next = [...current];
  let totalBytes = next.reduce((total, entry) => total + utf8ByteLength(entry.message), 0);
  for (const entry of incoming) {
    const boundedEntry = {
      ...entry,
      message: truncateUtf8(entry.message, DEFAULT_MAX_LOG_ENTRY_BYTES),
    };
    next.push(boundedEntry);
    totalBytes += utf8ByteLength(boundedEntry.message);
    while (next.length > DEFAULT_MAX_LOG_BUFFER_ENTRIES || totalBytes > DEFAULT_MAX_LOG_BUFFER_BYTES) {
      const removed = next.shift();
      if (!removed) break;
      totalBytes -= utf8ByteLength(removed.message);
    }
  }
  return next;
}

export const useRunnerStore = defineStore('runner', () => {
  const currentSession = ref<RunSessionDto | null>(null);
  const serviceStatuses = ref<Map<string, RunnerServiceStatus>>(new Map());
  const logs = ref<LogEntryDto[]>([]);
  const isListening = ref(false);
  const activeSessions = ref<RunSessionDto[]>([]);
  const history = ref<RunSessionDto[]>([]);
  const unresolvedSessions = ref<RunSessionDto[]>([]);
  const stateLoaded = ref(false);
  const stateLoading = ref(false);
  const stateError = ref<string | null>(null);
  const persistenceError = ref<string | null>(null);
  let stateRequest = 0;
  let statusRevision = 0;

  async function fetchState(): Promise<boolean> {
    const request = ++stateRequest;
    const revision = statusRevision;
    stateLoading.value = true;
    try {
      if (!window.codehelm?.runner?.getState) throw new Error('运行记录接口不可用，请确认桌面版本。');
      const state = await window.codehelm.runner.getState();
      if (request !== stateRequest || revision !== statusRevision) return false;
      activeSessions.value = state.activeSessions;
      history.value = state.history;
      unresolvedSessions.value = state.unresolvedSessions;
      persistenceError.value = state.persistenceError ?? null;
      let statuses = new Map<string, RunnerServiceStatus>();
      for (const session of state.activeSessions) statuses = mergeRunSessionStatuses(statuses, session);
      serviceStatuses.value = statuses; // Never hydrate live controls from historical records.
      stateLoaded.value = true;
      stateError.value = null;
      return true;
    } catch (error) {
      if (request === stateRequest) stateError.value = displayIpcError(error, '运行记录读取失败');
      return false;
    } finally { if (request === stateRequest) stateLoading.value = false; }
  }

  const runningCount = computed(() => {
    let count = 0;
    for (const s of serviceStatuses.value.values()) {
      if (s.status === 'RUNNING' || s.status === 'STARTING') {
        count++;
      }
    }
    return count;
  });

  const unresolvedByProject = computed(() => {
    const counts = new Map<string, number>();
    for (const session of unresolvedSessions.value) {
      const count = session.services.filter(service => service.status === 'ORPHANED').length;
      counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + count);
    }
    return counts;
  });

  function getUnresolvedCount(projectId: string): number {
    return unresolvedByProject.value.get(projectId) ?? 0;
  }

  // Include older blocked records without promoting their PID/ports into serviceStatuses.
  const displayHistory = computed(() => {
    const unresolvedIds = new Set(unresolvedSessions.value.map(session => session.id));
    return [...unresolvedSessions.value, ...history.value.filter(session => !unresolvedIds.has(session.id))];
  });

  // Aggregate live events by project, never by a cached project's lastRunStatus.
  const projectStates = computed(() => {
    const groups = new Map<string, Map<string, RunnerServiceStatus>>();
    for (const [id, service] of serviceStatuses.value) {
      if (!service.projectId) continue;
      let group = groups.get(service.projectId);
      if (!group) groups.set(service.projectId, group = new Map());
      group.set(id, service);
    }
    // Keep failures even when the snapshot omits failed children from live controls.
    for (const session of activeSessions.value) {
      let group = groups.get(session.projectId);
      const pending = session.status === 'STARTING' && session.services.length === 0 && !group?.size;
      if (!pending && session.status !== 'PARTIAL_FAILED' && session.status !== 'FAILED') continue;
      if (!group) groups.set(session.projectId, group = new Map());
      group.set(`session:${session.id}`, { status: pending ? 'STARTING' : 'FAILED' });
    }
    const result = new Map<string, ProjectRuntimeState>();
    for (const [projectId, group] of groups) {
      result.set(projectId, {
        status: getProfileProcessStatus(Array.from(group.keys(), id => ({ id })), group),
        runningCount: [...group.values()].filter(s => s.projectId &&
          (s.status === 'RUNNING' || s.status === 'STARTING')).length,
      });
    }
    return result;
  });

  function getProjectState(projectId: string): ProjectRuntimeState {
    if (!stateLoaded.value || stateError.value) return { status: 'UNKNOWN', runningCount: 0 };
    return projectStates.value.get(projectId) ?? { status: 'STOPPED', runningCount: 0 };
  }

  function setupListeners() {
    if (isListening.value || !window.codehelm?.runner) return;
    isListening.value = true;

    window.codehelm.runner.onStatus((event: ServiceStatusEventDto) => {
      statusRevision++;
      serviceStatuses.value = mergeServiceStatus(serviceStatuses.value, event);

      if (currentSession.value) {
        const s = currentSession.value.services.find(
          (x) => x.serviceConfigId === event.serviceConfigId || x.id === event.serviceSessionId
        );
        if (s) {
          s.status = event.status;
          s.pid = event.pid;
          s.port = event.port;
        }
      }

      if (['STOPPED', 'FAILED', 'ORPHANED'].includes(event.status)) {
        void fetchState();
      }
    });

    window.codehelm.runner.onLogs((batch) => {
      logs.value = appendBoundedLogs(logs.value, batch.entries);
    });
    void fetchState();
  }

  async function confirmExecution(profileId: string, mode: RunnerExecutionMode, theme?: 'dark' | 'light') {
    if (!window.codehelm) throw new Error('CodeHelm bridge unavailable');
    return window.codehelm.runner.confirmExecution(profileId, mode, theme);
  }

  async function launchProfile(profileId: string, mode: RunnerExecutionMode, theme: 'dark' | 'light') {
    let token: string;
    try { token = await reuseExecutionApproval(profileId, mode); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Execution confirmation required')) throw error;
      token = await confirmExecution(profileId, mode, theme);
    }
    return mode === 'install' ? installAndStartProfile(profileId, token) : startProfile(profileId, token);
  }

  async function reuseExecutionApproval(profileId: string, mode: RunnerExecutionMode) {
    if (!window.codehelm) throw new Error('CodeHelm bridge unavailable');
    return window.codehelm.runner.reuseExecutionApproval(profileId, mode);
  }

  async function startProfile(profileId: string, approvalToken: string) {
    if (!window.codehelm) return null;
    setupListeners();
    try {
      const session = await window.codehelm.runner.start(profileId, approvalToken);
      currentSession.value = session;
      serviceStatuses.value = mergeRunSessionStatuses(serviceStatuses.value, session);
      return session;
    } finally { await fetchState(); }
  }

  async function installAndStartProfile(profileId: string, approvalToken: string) {
    if (!window.codehelm) return null;
    setupListeners();
    try {
      const session = await window.codehelm.runner.installAndStart(profileId, approvalToken);
      currentSession.value = session;
      serviceStatuses.value = mergeRunSessionStatuses(serviceStatuses.value, session);
      return session;
    } finally { await fetchState(); }
  }

  async function stopSession(sessionId: string) {
    if (!window.codehelm) return;
    await window.codehelm.runner.stopSession(sessionId);
    await fetchState();
  }

  async function stopService(serviceSessionId: string) {
    if (!window.codehelm) return;
    await window.codehelm.runner.stopService(serviceSessionId);
    await fetchState();
  }

  async function restartService(serviceSessionId: string) {
    if (!window.codehelm) return;
    try { await window.codehelm.runner.restartService(serviceSessionId); }
    finally { await fetchState(); }
  }

  function clearLogs() {
    logs.value = [];
  }

  return {
    activeSessions, history, unresolvedSessions, displayHistory, getUnresolvedCount,
    stateLoaded, stateLoading, stateError, persistenceError, fetchState,
    currentSession,
    serviceStatuses,
    runningCount,
    getProjectState,
    logs,
    setupListeners,
    confirmExecution,
    launchProfile,
    reuseExecutionApproval,
    startProfile,
    installAndStartProfile,
    stopSession,
    stopService,
    restartService,
    clearLogs,
  };
});
