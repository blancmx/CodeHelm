import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@codehelm/contracts';
import {
  EXECUTION_CONFIRMATION_REQUIRED_MESSAGE,
} from '../execution-approval.js';

const harness = vi.hoisted(() => {
  const profile = {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000002',
    name: 'Development',
    isDefault: true,
    failurePolicy: 'block_dependents' as const,
    services: [{
      id: 'service-1',
      runProfileId: '00000000-0000-4000-8000-000000000001',
      name: 'Web',
      type: 'frontend' as const,
      moduleRelativePath: '.',
      executable: 'npm',
      args: ['run', 'dev'],
      cwdRelative: '',
      env: [],
      dependsOn: [],
      enabled: true,
      source: 'manual' as const,
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const project = {
    id: profile.projectId,
    name: 'Test project',
    rootPath: 'E:/projects/codehelm-test',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const session = {
    id: '00000000-0000-4000-8000-000000000003',
    projectId: project.id,
    runProfileId: profile.id,
    status: 'RUNNING' as const,
    startedAt: '2026-01-01T00:00:00.000Z',
    services: [],
  };
  const startSession = vi.fn(async () => session);
  const restartService = vi.fn();
  const sender = { mainFrame: {} };
  const owner = { isDestroyed: () => false, webContents: sender };
  const event = { sender, senderFrame: sender.mainFrame };
  const showConfirmation = vi.fn(async () => true);
  const isPythonModuleAvailable = vi.fn(() => true);
  const spawn = vi.fn(() => {
    throw new Error('spawn should not run before approval');
  });
  const plans: Array<{
    key: string;
    label: string;
    cwd: string;
    executable: string;
    args: string[];
    pythonModuleCheck?: { moduleName: string };
  }> = [{
    key: 'node:npm:E:/projects/codehelm-test',
    label: '. (npm)',
    cwd: project.rootPath,
    executable: 'npm',
    args: ['install'],
  }];
  const createPlans = vi.fn(() => plans);
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  const onLogs = vi.fn();
  const getActiveSessions = vi.fn((): unknown[] => []);

  class MockOrchestrator {
    setSessionPersistence = vi.fn();
    getActiveSessions = getActiveSessions;
    getPersistenceError = vi.fn();
    assertCanStart = vi.fn();
    onStatusChange = vi.fn();
    onLogs = onLogs;
    startSession = startSession;
    stopSession = vi.fn();
    stopService = vi.fn();
    restartService = restartService;
  }

  class MockProfileRepository {
    constructor(_db: unknown) {}
    findById() {
      return profile;
    }
    save() {
      return profile;
    }
  }

  class MockProjectRepository {
    constructor(_db: unknown) {}
    findById() {
      return project;
    }
  }
  const hasUnresolvedProfile = vi.fn(() => false);
  const listUnresolved = vi.fn((): unknown[] => []);
  class MockSessionRepository {
    listUnfinished() { return []; }
    listRecent() { return []; }
    listUnresolved = listUnresolved;
    save = vi.fn();
    hasUnresolvedProfile = hasUnresolvedProfile;
  }

  return {
    profile,
    event,
    owner,
    session,
    startSession,
    restartService,
    showConfirmation,
    isPythonModuleAvailable,
    spawn,
    plans,
    createPlans,
    handlers,
    onLogs,
    getActiveSessions,
    MockOrchestrator,
    MockProfileRepository,
    MockProjectRepository,
    MockSessionRepository,
    hasUnresolvedProfile,
    listUnresolved,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      harness.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: (sender: unknown) => sender === harness.event.sender ? harness.owner : null },
}));
vi.mock('../../execution-confirmation-window.js', () => ({ showExecutionConfirmation: harness.showConfirmation }));
vi.mock('@codehelm/database', () => ({
  ProfileRepository: harness.MockProfileRepository,
  ProjectRepository: harness.MockProjectRepository,
  SessionRepository: harness.MockSessionRepository,
}));
vi.mock('@codehelm/runner', () => ({ Orchestrator: harness.MockOrchestrator }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: harness.spawn,
}));
vi.mock('../dependency-installer.js', () => ({
  createDependencyInstallPlans: harness.createPlans,
  checkPythonModuleAvailable: harness.isPythonModuleAvailable,
}));
vi.mock('../runtime-profile-constraints.js', () => ({
  applyRuntimeProfileConstraints: (_rootPath: string, profile: typeof harness.profile) => ({
    profile,
    messages: [],
  }),
}));

import { registerRunnerHandlers } from '../runner-handlers.js';

const db = {
  prepare: vi.fn(() => ({ run: vi.fn() })),
};

const logSink = { accept: vi.fn() };
await registerRunnerHandlers(db as never, logSink as never);

function handler(channel: string) {
  const selected = harness.handlers.get(channel);
  if (!selected) throw new Error(`Missing IPC handler: ${channel}`);
  return selected;
}

describe('runner IPC execution authorization', () => {
  it('retains failed siblings in an active partial run without promoting history into live state', () => {
    const run = { ...harness.session, status: 'PARTIAL_FAILED', services: [
      { id: 'failed', runSessionId: harness.session.id, serviceConfigId: 'a', serviceName: 'A', serviceType: 'tool', status: 'FAILED', exitCode: 7 },
      { id: 'live', runSessionId: harness.session.id, serviceConfigId: 'd', serviceName: 'D', serviceType: 'backend', status: 'RUNNING', port: 5180 },
    ] };
    harness.getActiveSessions.mockReturnValueOnce([run]);
    expect(handler(IpcChannels.RUNNER_GET_STATE)({})).toMatchObject({ activeSessions: [run], history: [] });
  });
  it('rejects confirmation requests from unowned windows or child frames', async () => {
    const request = { profileId: harness.profile.id, mode: 'start' };
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)({ sender: {}, senderFrame: {} }, request)).rejects.toThrow('主窗口');
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)({ ...harness.event, senderFrame: {} }, request)).rejects.toThrow('主窗口');
  });

  it('does not authorize a profile that changes while its confirmation is open', async () => {
    const before = [...harness.profile.services[0].args];
    harness.showConfirmation.mockImplementationOnce(async () => {
      harness.profile.services[0].args = ['run', 'changed-during-review'];
      return true;
    });
    try {
      await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, {
        profileId: harness.profile.id, mode: 'start', theme: 'light',
      })).rejects.toThrow('执行内容已变化');
    } finally { harness.profile.services[0].args = before; }
  });

  it.each(['DEGRADED', 'FAILED', 'STOPPED'])('rejects a %s restart instead of returning success', async status => {
    harness.restartService.mockResolvedValueOnce({ status, errorMessage: 'restart not ready' });
    await expect(handler(IpcChannels.RUNNER_RESTART_SERVICE)({}, 'old-child')).rejects.toThrow('restart not ready');
  });

  it('exposes a detached live/history snapshot and blocks execution when a historical process is unresolved', async () => {
    expect(handler(IpcChannels.RUNNER_GET_STATE)({})).toMatchObject({ activeSessions: [], history: [], unresolvedSessions: [] });
    harness.hasUnresolvedProfile.mockReturnValue(true);
    const old = { ...harness.session, status: 'INTERRUPTED', services: [{
      id: 'old-child', runSessionId: harness.session.id, serviceConfigId: 'service-1',
      serviceName: 'Old', serviceType: 'tool', status: 'ORPHANED', pid: 123,
    }] };
    harness.listUnresolved.mockReturnValue([old]);
    try {
      expect(handler(IpcChannels.RUNNER_GET_STATE)({})).toMatchObject({ activeSessions: [], history: [], unresolvedSessions: [old] });
      await expect(handler(IpcChannels.RUNNER_START_SESSION)({}, { profileId: harness.profile.id, approvalToken: 'token' })).rejects.toThrow('未确认归属');
      await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)({}, { profileId: harness.profile.id, approvalToken: 'token' })).rejects.toThrow('未确认归属');
    } finally { harness.hasUnresolvedProfile.mockReturnValue(false); harness.listUnresolved.mockReturnValue([]); }
  });
  it('routes real orchestrator log batches to the persistent sink', () => {
    const batch = { projectId: harness.profile.projectId, runSessionId: harness.session.id, entries: [] };
    harness.onLogs.mock.calls[0][0](batch);
    expect(logSink.accept).toHaveBeenCalledWith(batch);
  });
  it('blocks both execution sinks without a main-process approval', async () => {
    const request = {
      profileId: harness.profile.id,
      approvalToken: 'not-issued',
    };

    await expect(handler(IpcChannels.RUNNER_START_SESSION)({}, request))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)({}, request))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);

    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.spawn).not.toHaveBeenCalled();
    expect(harness.createPlans).not.toHaveBeenCalled();
  });

  it('does not mint an approval when the main-process confirmation is cancelled', async () => {
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.showConfirmation.mockResolvedValueOnce(false);
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, {
      profileId: harness.profile.id,
      mode: 'start',
    })).rejects.toThrow('Execution confirmation cancelled.');
    expect(harness.startSession).not.toHaveBeenCalled();
  });

  it('defers inferred Python checks until after the isolated confirmation', async () => {
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.isPythonModuleAvailable.mockClear();
    harness.profile.services[0].executable = 'python';
    harness.profile.services[0].args = ['-m', 'flask'];
    harness.profile.services[0].moduleRelativePath = '.';
    harness.profile.services[0].cwdRelative = '';
    harness.createPlans.mockReturnValue([{
      key: 'python-inferred:python:flask:e:/projects/codehelm-test',
      label: '. (Flask, inferred if missing)',
      cwd: 'E:/projects/codehelm-test',
      executable: 'python',
      args: ['-m', 'pip', 'install', 'Flask'],
      pythonModuleCheck: { moduleName: 'flask' },
    }]);

    harness.showConfirmation.mockResolvedValueOnce(false);
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, {
      profileId: harness.profile.id,
      mode: 'install',
    })).rejects.toThrow('Execution confirmation cancelled.');
    expect(harness.isPythonModuleAvailable).not.toHaveBeenCalled();

    const token = await handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, {
      profileId: harness.profile.id,
      mode: 'install',
    });
    expect(harness.isPythonModuleAvailable).not.toHaveBeenCalled();

    await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)({}, {
      profileId: harness.profile.id,
      approvalToken: token,
    })).resolves.toMatchObject({ id: harness.session.id });
    expect(harness.isPythonModuleAvailable).toHaveBeenCalledWith(
      'python',
      'flask',
      'E:/projects/codehelm-test'
    );
  });

  it('consumes a confirmed token once and rejects a changed configuration', async () => {
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    const confirm = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION);
    const start = handler(IpcChannels.RUNNER_START_SESSION);
    const reuse = handler(IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL);
    const confirmationRequest = { profileId: harness.profile.id, mode: 'start' };
    const token = await confirm(harness.event, confirmationRequest);
    expect(harness.showConfirmation).toHaveBeenCalledTimes(1);

    await expect(start({}, { profileId: harness.profile.id, approvalToken: token }))
      .resolves.toMatchObject({ id: harness.session.id });
    expect(harness.startSession).toHaveBeenCalledTimes(1);
    await expect(start({}, { profileId: harness.profile.id, approvalToken: token }))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);

    harness.profile.services[0].executable = 'pnpm';
    await expect(reuse({}, confirmationRequest))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    expect(harness.startSession).toHaveBeenCalledTimes(1);
  });

  it('requires a separate approval for the dependency-install execution mode', async () => {
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.profile.services[0].executable = 'npm';
    harness.createPlans.mockReturnValue([]);
    const confirm = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION);
    const install = handler(IpcChannels.RUNNER_INSTALL_AND_START);
    const token = await confirm(harness.event, { profileId: harness.profile.id, mode: 'install' });

    await expect(install({}, { profileId: harness.profile.id, approvalToken: token }))
      .resolves.toMatchObject({ id: harness.session.id });
    expect(harness.startSession).toHaveBeenCalledTimes(1);
  });
});
