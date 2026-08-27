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
  const showMessageBox = vi.fn(async () => ({ response: 0 }));
  const spawn = vi.fn(() => {
    throw new Error('spawn should not run before approval');
  });
  const plans = [{
    key: 'node:npm:E:/projects/codehelm-test',
    label: '. (npm)',
    cwd: project.rootPath,
    executable: 'npm',
    args: ['install'],
  }];
  const createPlans = vi.fn(() => plans);
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();

  class MockOrchestrator {
    onStatusChange = vi.fn();
    onLogs = vi.fn();
    startSession = startSession;
    stopSession = vi.fn();
    stopService = vi.fn();
    restartService = vi.fn();
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

  return {
    profile,
    session,
    startSession,
    showMessageBox,
    spawn,
    plans,
    createPlans,
    handlers,
    MockOrchestrator,
    MockProfileRepository,
    MockProjectRepository,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      harness.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: harness.showMessageBox },
}));
vi.mock('@codehelm/database', () => ({
  ProfileRepository: harness.MockProfileRepository,
  ProjectRepository: harness.MockProjectRepository,
}));
vi.mock('@codehelm/runner', () => ({ Orchestrator: harness.MockOrchestrator }));
vi.mock('node:child_process', () => ({ spawn: harness.spawn }));
vi.mock('../dependency-installer.js', () => ({
  createDependencyInstallPlans: harness.createPlans,
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

registerRunnerHandlers(db as never);

function handler(channel: string) {
  const selected = harness.handlers.get(channel);
  if (!selected) throw new Error(`Missing IPC handler: ${channel}`);
  return selected;
}

describe('runner IPC execution authorization', () => {
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
    harness.showMessageBox.mockClear();
    harness.startSession.mockClear();
    harness.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(handler(IpcChannels.RUNNER_CONFIRM_EXECUTION)({}, {
      profileId: harness.profile.id,
      mode: 'start',
    })).rejects.toThrow('Execution confirmation cancelled.');
    expect(harness.startSession).not.toHaveBeenCalled();
  });

  it('consumes a confirmed token once and rejects a changed configuration', async () => {
    harness.showMessageBox.mockClear();
    harness.startSession.mockClear();
    const confirm = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION);
    const start = handler(IpcChannels.RUNNER_START_SESSION);
    const reuse = handler(IpcChannels.RUNNER_REUSE_EXECUTION_APPROVAL);
    const confirmationRequest = { profileId: harness.profile.id, mode: 'start' };
    const token = await confirm({}, confirmationRequest);
    expect(harness.showMessageBox).toHaveBeenCalledTimes(1);

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
    harness.showMessageBox.mockClear();
    harness.startSession.mockClear();
    harness.profile.services[0].executable = 'npm';
    harness.createPlans.mockReturnValue([]);
    const confirm = handler(IpcChannels.RUNNER_CONFIRM_EXECUTION);
    const install = handler(IpcChannels.RUNNER_INSTALL_AND_START);
    const token = await confirm({}, { profileId: harness.profile.id, mode: 'install' });

    await expect(install({}, { profileId: harness.profile.id, approvalToken: token }))
      .resolves.toMatchObject({ id: harness.session.id });
    expect(harness.startSession).toHaveBeenCalledTimes(1);
  });
});
