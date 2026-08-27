import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
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

  const runningCount = computed(() => {
    let count = 0;
    for (const s of serviceStatuses.value.values()) {
      if (s.status === 'RUNNING' || s.status === 'STARTING') {
        count++;
      }
    }
    return count;
  });

  function setupListeners() {
    if (isListening.value || !window.codehelm?.runner) return;
    isListening.value = true;

    window.codehelm.runner.onStatus((event: ServiceStatusEventDto) => {
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

    });

    window.codehelm.runner.onLogs((batch) => {
      logs.value = appendBoundedLogs(logs.value, batch.entries);
    });
  }

  async function confirmExecution(profileId: string, mode: RunnerExecutionMode) {
    if (!window.codehelm) throw new Error('CodeHelm bridge unavailable');
    return window.codehelm.runner.confirmExecution(profileId, mode);
  }

  async function reuseExecutionApproval(profileId: string, mode: RunnerExecutionMode) {
    if (!window.codehelm) throw new Error('CodeHelm bridge unavailable');
    return window.codehelm.runner.reuseExecutionApproval(profileId, mode);
  }

  async function startProfile(profileId: string, approvalToken: string) {
    if (!window.codehelm) return null;
    setupListeners();
    const session = await window.codehelm.runner.start(profileId, approvalToken);
    currentSession.value = session;
    serviceStatuses.value = mergeRunSessionStatuses(serviceStatuses.value, session);
    return session;
  }

  async function installAndStartProfile(profileId: string, approvalToken: string) {
    if (!window.codehelm) return null;
    setupListeners();
    const session = await window.codehelm.runner.installAndStart(profileId, approvalToken);
    currentSession.value = session;
    serviceStatuses.value = mergeRunSessionStatuses(serviceStatuses.value, session);
    return session;
  }

  async function stopSession(sessionId: string) {
    if (!window.codehelm) return;
    await window.codehelm.runner.stopSession(sessionId);
    if (currentSession.value?.id === sessionId) {
      currentSession.value.status = 'STOPPED';
      for (const s of currentSession.value.services) {
        s.status = 'STOPPED';
        s.pid = undefined;
      }
    }
    for (const [key, val] of serviceStatuses.value.entries()) {
      serviceStatuses.value.set(key, { ...val, status: 'STOPPED', pid: undefined });
    }
    serviceStatuses.value = new Map(serviceStatuses.value);
  }

  async function stopService(serviceSessionId: string) {
    if (!window.codehelm) return;
    await window.codehelm.runner.stopService(serviceSessionId);
    for (const [key, val] of serviceStatuses.value.entries()) {
      if (val.sessionServiceId === serviceSessionId || key === serviceSessionId) {
        serviceStatuses.value.set(key, { ...val, status: 'STOPPED', pid: undefined });
      }
    }
    serviceStatuses.value = new Map(serviceStatuses.value);
  }

  async function restartService(serviceSessionId: string) {
    if (!window.codehelm) return;
    await window.codehelm.runner.restartService(serviceSessionId);
  }

  function clearLogs() {
    logs.value = [];
  }

  return {
    currentSession,
    serviceStatuses,
    runningCount,
    logs,
    setupListeners,
    confirmExecution,
    reuseExecutionApproval,
    startProfile,
    installAndStartProfile,
    stopSession,
    stopService,
    restartService,
    clearLogs,
  };
});
