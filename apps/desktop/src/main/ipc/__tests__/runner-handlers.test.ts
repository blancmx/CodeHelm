import { ipcMain } from 'electron';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IpcChannels } from '@codehelm/contracts';
import {
  EXECUTION_CONFIRMATION_REQUIRED_MESSAGE,
} from '../execution-approval.js';

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-runner-handlers-'));
  const editedProjectRoot = path.join(projectRoot, 'edited-root');
  await fs.mkdir(editedProjectRoot);
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
      source: 'manual' as 'manual' | 'detected',
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const project = {
    id: profile.projectId,
    name: 'Test project',
    rootPath: projectRoot,
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
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, id: 1 });
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: sender });
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
    key: `node:npm:${projectRoot}`,
    label: '. (npm)',
    cwd: project.rootPath,
    executable: 'npm',
    args: ['install'],
  }];
  const createPlans = vi.fn(() => plans);
  const applyConstraints = vi.fn(async (_root: string, input: typeof profile, _options?: { signal?: AbortSignal }) => ({ profile: input, messages: [] as string[] }));
  const saveProfile = vi.fn(() => profile);
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
    stopAll = vi.fn();
    stopSession = vi.fn();
    stopService = vi.fn();
    restartService = restartService;
  }

  class MockProfileRepository {
    constructor(_db: unknown) {}
    findById() {
      return profile;
    }
    save = saveProfile;
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
    project,
    projectRoot,
    editedProjectRoot,
    applyConstraints,
    saveProfile,
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
  applyRuntimeProfileConstraints: harness.applyConstraints,
}));

import { registerRunnerHandlers, stopAllRunnerSessions } from '../runner-handlers.js';

const db = {
  prepare: vi.fn(() => ({ run: vi.fn() })),
};

const logSink = { accept: vi.fn() };
await registerRunnerHandlers(ipcMain.handle, db as never, logSink as never);

afterAll(async () => {
  await fsp.rm(harness.projectRoot, { recursive: true, force: true });
});

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
      await expect(handler(IpcChannels.RUNNER_START_SESSION)(harness.event, { profileId: harness.profile.id, approvalToken: 'token' })).rejects.toThrow('未确认归属');
      await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)(harness.event, { profileId: harness.profile.id, approvalToken: 'token' })).rejects.toThrow('未确认归属');
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

    await expect(handler(IpcChannels.RUNNER_START_SESSION)(harness.event, request))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)(harness.event, request))
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
      key: `python-inferred:python:flask:${harness.projectRoot}`,
      label: '. (Flask, inferred if missing)',
      cwd: harness.projectRoot,
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

    await expect(handler(IpcChannels.RUNNER_INSTALL_AND_START)(harness.event, {
      profileId: harness.profile.id,
      approvalToken: token,
    })).resolves.toMatchObject({ id: harness.session.id });
    expect(harness.isPythonModuleAvailable).toHaveBeenCalledWith(
      'python',
      'flask',
      harness.projectRoot
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

    await expect(start(harness.event, { profileId: harness.profile.id, approvalToken: token }))
      .resolves.toMatchObject({ id: harness.session.id });
    expect(harness.startSession).toHaveBeenCalledTimes(1);
    await expect(start(harness.event, { profileId: harness.profile.id, approvalToken: token }))
      .rejects.toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);

    harness.profile.services[0].executable = 'pnpm';
    await expect(reuse(harness.event, confirmationRequest))
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

    await expect(install(harness.event, { profileId: harness.profile.id, approvalToken: token }))
      .resolves.toMatchObject({ id: harness.session.id });
    expect(harness.startSession).toHaveBeenCalledTimes(1);
  });
});

describe('runner asynchronous approval boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  function pauseNextResolution() {
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const original = fsp.realpath.bind(fsp);
    vi.spyOn(fsp, 'realpath').mockImplementationOnce(async (...args) => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return original(...args);
    });
    return { reached, release: () => release() };
  }

  it.each([
    IpcChannels.RUNNER_CONFIRM_EXECUTION, IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL,
    IpcChannels.RUNNER_START_SESSION, IpcChannels.RUNNER_INSTALL_AND_START,
  ])('rejects oversized input through %s without confirmation or execution', async channel => {
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.spawn.mockClear();
    harness.isPythonModuleAvailable.mockClear();
    vi.spyOn(fsp, 'stat').mockResolvedValue({ size: 33 * 1024 * 1024, isFile: () => true, isDirectory: () => false } as never);
    await expect(handler(channel)(harness.event, {
      profileId: harness.profile.id, mode: 'start', approvalToken: 'not-issued',
    })).rejects.toThrow('单文件');
    expect(harness.showConfirmation).not.toHaveBeenCalled();
    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.spawn).not.toHaveBeenCalled();
    expect(harness.isPythonModuleAvailable).not.toHaveBeenCalled();
  });

  it('rejects a changed configuration after asynchronous hashing', async () => {
    const pause = pauseNextResolution();
    const before = [...harness.profile.services[0].args];
    const request = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    await pause.reached;
    harness.profile.services[0].args = ['changed-during-hash'];
    pause.release();
    try { await expect(request).rejects.toThrow('执行内容已变化'); }
    finally { harness.profile.services[0].args = before; }
  });

  it.each(['closed', 'did-start-navigation', 'render-process-gone'])('cancels hashing on %s and releases the request slot', async event => {
    harness.showConfirmation.mockClear();
    const pause = pauseNextResolution();
    const request = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    const rejected = expect(request).rejects.toThrow('取消');
    await pause.reached;
    (event === 'closed' ? harness.owner : harness.event.sender).emit(event);
    await rejected;
    expect(harness.showConfirmation).not.toHaveBeenCalled();
    pause.release();
    // The next owned request is accepted after cancellation; no stale listener.
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' })).resolves.toEqual(expect.any(String));
    expect(harness.owner.listenerCount('closed')).toBe(0);
    expect(harness.event.sender.listenerCount('did-start-navigation')).toBe(0);
  });

  it('rejects a second request while the same window is hashing', async () => {
    const pause = pauseNextResolution();
    const request = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    await pause.reached;
    await expect(handler(IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL)(harness.event, {
      profileId: harness.profile.id, mode: 'start',
    })).rejects.toThrow('已有执行请求');
    pause.release();
    await request;
  });

  it.each([
    IpcChannels.RUNNER_CONFIRM_EXECUTION, IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL,
    IpcChannels.RUNNER_START_SESSION, IpcChannels.RUNNER_INSTALL_AND_START,
  ])('propagates a runtime scan budget failure through %s before side effects', async channel => {
    harness.applyConstraints.mockRejectedValueOnce(new Error('运行配置扫描目录条目超限'));
    harness.saveProfile.mockClear();
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.isPythonModuleAvailable.mockClear();
    await expect(handler(channel)(harness.event, {
      profileId: harness.profile.id, mode: 'start', approvalToken: 'unused',
    })).rejects.toThrow('目录条目');
    expect(harness.saveProfile).not.toHaveBeenCalled();
    expect(harness.showConfirmation).not.toHaveBeenCalled();
    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.isPythonModuleAvailable).not.toHaveBeenCalled();
  });

  it.each(['args', 'name', 'root'])('does not overwrite a concurrent %s edit with scan results', async field => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    harness.applyConstraints.mockImplementationOnce(async (_root, input) => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return { profile: { ...input, services: [{ ...input.services[0], args: ['inferred'] }] }, messages: ['synthetic constraint'] };
    });
    harness.saveProfile.mockClear();
    harness.showConfirmation.mockClear();
    const before = structuredClone({ profile: harness.profile, project: harness.project });
    const request = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    await started;
    if (field === 'args') harness.profile.services[0].args = ['edited'];
    if (field === 'name') harness.profile.name = 'edited';
    if (field === 'root') harness.project.rootPath = harness.editedProjectRoot;
    release();
    try {
      await expect(request).rejects.toThrow('执行内容已变化');
      expect(harness.saveProfile).not.toHaveBeenCalled();
      expect(harness.showConfirmation).not.toHaveBeenCalled();
    } finally {
      Object.assign(harness.profile, before.profile);
      Object.assign(harness.project, before.project);
    }
  });

  it('propagates window cancellation into discovery and never persists its late result', async () => {
    let release!: () => void;
    let entered!: () => void;
    let scanSignal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    harness.applyConstraints.mockImplementationOnce(async (_root, input, options) => {
      scanSignal = options?.signal;
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return { profile: input, messages: ['must not persist'] };
    });
    harness.saveProfile.mockClear();
    harness.showConfirmation.mockClear();
    const request = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    await started;
    harness.owner.emit('closed');
    expect(scanSignal?.aborted).toBe(true);
    release();
    await expect(request).rejects.toThrow('取消');
    expect(harness.saveProfile).not.toHaveBeenCalled();
    expect(harness.showConfirmation).not.toHaveBeenCalled();
  });

  it('rejects a real oversized launcher through the actual scanner before native confirmation', async () => {
    const actual = await vi.importActual<typeof import('../runtime-profile-constraints.js')>('../runtime-profile-constraints.js');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'codehelm-runtime-ipc-'));
    const before = structuredClone({ profile: harness.profile, project: harness.project });
    harness.showConfirmation.mockClear();
    harness.startSession.mockClear();
    harness.saveProfile.mockClear();
    try {
      await fsp.writeFile(path.join(root, 'start.bat'), Buffer.alloc(512 * 1024 + 1, 32));
      harness.profile.services[0].source = 'detected';
      harness.project.rootPath = root;
      harness.applyConstraints.mockImplementationOnce(async (projectRoot, input, options) => (
        await actual.applyRuntimeProfileConstraints(projectRoot, input, options)
      ) as Awaited<ReturnType<typeof harness.applyConstraints>>);
      await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, {
        profileId: harness.profile.id, mode: 'start',
      })).rejects.toThrow('单文件');
      expect(harness.showConfirmation).not.toHaveBeenCalled();
      expect(harness.saveProfile).not.toHaveBeenCalled();
      expect(harness.startSession).not.toHaveBeenCalled();
    } finally {
      Object.assign(harness.profile, before.profile);
      Object.assign(harness.project, before.project);
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('never starts a suspended request after application shutdown', async () => {
    const token = await handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)(harness.event, { profileId: harness.profile.id, mode: 'start' });
    harness.startSession.mockClear();
    const pause = pauseNextResolution();
    const request = handler(IpcChannels.RUNNER_START_SESSION)(harness.event, { profileId: harness.profile.id, approvalToken: token });
    const rejected = expect(request).rejects.toThrow();
    await pause.reached;
    await stopAllRunnerSessions();
    await rejected;
    pause.release();
    await new Promise(resolve => setImmediate(resolve));
    expect(harness.startSession).not.toHaveBeenCalled();
  });
});
