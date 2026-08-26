import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LogEntryDto, ProcessStatus, RunSessionDto, ServiceStatusEventDto } from '@codehelm/contracts';

export interface RunnerServiceStatus {
  status: ProcessStatus;
  pid?: number;
  port?: number;
  sessionServiceId?: string;
  serviceName?: string;
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
  });
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
      logs.value.push(...batch.entries);
      if (logs.value.length > 5000) {
        logs.value = logs.value.slice(-5000);
      }
    });
  }

  async function startProfile(profileId: string) {
    if (!window.codehelm) return null;
    setupListeners();
    const session = await window.codehelm.runner.start(profileId);
    currentSession.value = session;
    return session;
  }

  async function installAndStartProfile(profileId: string) {
    if (!window.codehelm) return null;
    setupListeners();
    const session = await window.codehelm.runner.installAndStart(profileId);
    currentSession.value = session;
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
    startProfile,
    installAndStartProfile,
    stopSession,
    stopService,
    restartService,
    clearLogs,
  };
});
