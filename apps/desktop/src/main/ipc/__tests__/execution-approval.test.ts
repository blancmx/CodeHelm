import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunProfile } from '@codehelm/domain';
import {
  createExecutionConfigurationFingerprint,
  createExecutionFingerprint,
  EXECUTION_ALREADY_IN_PROGRESS_MESSAGE,
  EXECUTION_CONFIRMATION_REQUIRED_MESSAGE,
  ExecutionApprovalGuard,
  ExecutionSlotGuard,
} from '../execution-approval.js';

function context(overrides: Partial<{
  profileId: string;
  mode: 'start' | 'install';
  configurationFingerprint: string;
  executionFingerprint: string;
}> = {}) {
  return {
    profileId: 'profile-1',
    mode: 'start' as const,
    configurationFingerprint: 'configuration-a',
    executionFingerprint: 'execution-a',
    ...overrides,
  };
}

function profile(): RunProfile {
  return {
    id: 'profile-1',
    projectId: 'project-1',
    name: 'Development',
    description: 'Local development',
    isDefault: true,
    failurePolicy: 'block_dependents',
    services: [{
      id: 'service-1',
      runProfileId: 'profile-1',
      name: 'Web',
      type: 'frontend',
      moduleRelativePath: 'web',
      executable: 'npm',
      args: ['run', 'dev'],
      cwdRelative: 'web',
      env: [{ key: 'PORT', value: '5173' }],
      port: 5173,
      portMode: 'fixed',
      dependsOn: [],
      enabled: true,
      source: 'manual',
    }],
    userConfirmedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ExecutionApprovalGuard', () => {
  it('rejects reuse and consumption before an explicit confirmation', () => {
    const guard = new ExecutionApprovalGuard();
    const execution = context();

    expect(() => guard.reuse(execution)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    expect(() => guard.consume(execution, 'unissued-token'))
      .toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
  });

  it('allows the confirmed execution exactly once', () => {
    let sequence = 0;
    const guard = new ExecutionApprovalGuard({
      tokenFactory: () => `token-${++sequence}`,
    });
    const execution = context();
    const token = guard.confirm(execution);

    expect(() => guard.consume(execution, token)).not.toThrow();
    expect(() => guard.consume(execution, token)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
  });

  it('reuses approval only for the same configuration and install plan', () => {
    let sequence = 0;
    const guard = new ExecutionApprovalGuard({
      tokenFactory: () => `token-${++sequence}`,
    });
    const start = context();
    const install = context({
      mode: 'install',
      executionFingerprint: 'install-plan-a',
    });

    guard.confirm(start);
    expect(() => guard.reuse(install)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);

    const installToken = guard.confirm(install);
    expect(() => guard.consume(install, installToken)).not.toThrow();
    expect(() => guard.reuse(context({ executionFingerprint: 'execution-b' })))
      .toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
  });

  it('invalidates an old approval when the profile configuration changes', () => {
    let sequence = 0;
    const guard = new ExecutionApprovalGuard({
      tokenFactory: () => `token-${++sequence}`,
    });
    const original = context();
    const changed = context({
      configurationFingerprint: 'configuration-b',
      executionFingerprint: 'execution-b',
    });
    const oldToken = guard.confirm(original);

    expect(() => guard.consume(changed, oldToken)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    expect(() => guard.reuse(original)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
    const newToken = guard.confirm(changed);
    expect(() => guard.consume(changed, newToken)).not.toThrow();
  });

  it('expires approvals and rejects a changed install plan', () => {
    let now = 0;
    let sequence = 0;
    const guard = new ExecutionApprovalGuard({
      now: () => now,
      ttlMs: 100,
      tokenFactory: () => `token-${++sequence}`,
    });
    const install = context({ mode: 'install', executionFingerprint: 'install-plan-a' });
    const token = guard.confirm(install);

    expect(() => guard.consume(
      context({ mode: 'install', executionFingerprint: 'install-plan-b' }),
      token
    )).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);

    const freshToken = guard.confirm(install);
    now = 100;
    expect(() => guard.consume(install, freshToken)).toThrow(EXECUTION_CONFIRMATION_REQUIRED_MESSAGE);
  });

  it('does not let confirmation metadata change the execution fingerprint', () => {
    const first = profile();
    const second = {
      ...first,
      userConfirmedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      name: 'Renamed profile',
    };
    const root = 'E:/projects/codehelm';
    const plans = [{
      key: 'node:npm:E:/projects/codehelm/web',
      label: 'web (npm)',
      cwd: 'E:/projects/codehelm/web',
      executable: 'npm',
      args: ['install'],
    }];

    expect(createExecutionConfigurationFingerprint(first, root))
      .toBe(createExecutionConfigurationFingerprint(second, root));
    expect(createExecutionFingerprint(first, root, 'install', plans))
      .toBe(createExecutionFingerprint(second, root, 'install', plans));

    const changed = {
      ...second,
      services: [{ ...second.services[0], executable: 'pnpm' }],
    };
    expect(createExecutionConfigurationFingerprint(first, root))
      .not.toBe(createExecutionConfigurationFingerprint(changed, root));
  });

  it('invalidates an install approval when package input contents change', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-approval-input-'));
    const moduleRoot = path.join(root, 'web');
    fs.mkdirSync(moduleRoot);
    const approvedProfile = profile();
    approvedProfile.services[0].cwdRelative = 'web';
    approvedProfile.services[0].moduleRelativePath = 'web';
    const plans = [{
      key: 'node:npm:E:/projects/codehelm-approval-input/web',
      label: 'web (npm)',
      cwd: moduleRoot,
      executable: 'npm',
      args: ['install'],
    }];

    try {
      fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{"scripts":{"dev":"vite"}}');
      const before = createExecutionFingerprint(approvedProfile, root, 'install', plans);
      fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{"scripts":{"dev":"evil"}}');
      const after = createExecutionFingerprint(approvedProfile, root, 'install', plans);

      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ExecutionSlotGuard', () => {
  it('serializes execution per profile while allowing other profiles', () => {
    const slots = new ExecutionSlotGuard();

    slots.acquire('profile-1');
    expect(() => slots.assertAvailable('profile-1'))
      .toThrow(EXECUTION_ALREADY_IN_PROGRESS_MESSAGE);
    expect(() => slots.acquire('profile-1'))
      .toThrow(EXECUTION_ALREADY_IN_PROGRESS_MESSAGE);
    expect(() => slots.acquire('profile-2')).not.toThrow();

    slots.release('profile-1');
    expect(() => slots.acquire('profile-1')).not.toThrow();
  });
});
