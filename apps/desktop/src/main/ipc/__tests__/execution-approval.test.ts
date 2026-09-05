import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EXECUTION_READ_LIMITS, withExecutionReadBudget } from '../execution-input-reader.js';
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

  it('does not let confirmation metadata change the execution fingerprint', async () => {
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

    expect(await createExecutionConfigurationFingerprint(first, root))
      .toBe(await createExecutionConfigurationFingerprint(second, root));
    expect(await createExecutionFingerprint(first, root, 'install', plans))
      .toBe(await createExecutionFingerprint(second, root, 'install', plans));

    const changed = {
      ...second,
      services: [{ ...second.services[0], executable: 'pnpm' }],
    };
    expect(await createExecutionConfigurationFingerprint(first, root))
      .not.toBe(await createExecutionConfigurationFingerprint(changed, root));
  });

  it('invalidates an install approval when package input contents change', async () => {
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
      const before = await createExecutionFingerprint(approvedProfile, root, 'install', plans);
      fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{"scripts":{"dev":"evil"}}');
      const after = await createExecutionFingerprint(approvedProfile, root, 'install', plans);

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

describe('bounded execution input reads', () => {
  afterEach(() => vi.restoreAllMocks());

  function file(size = 8) {
    const metadata = { size, dev: 1, ino: 2, mtimeMs: 3, ctimeMs: 4, isFile: () => true, isDirectory: () => false };
    const handle = {
      stat: vi.fn(async () => ({ ...metadata })),
      read: vi.fn(async (buffer: Buffer, offset: number, length: number) => {
        buffer.fill(97, offset, offset + length);
        return { bytesRead: length, buffer };
      }),
      close: vi.fn(async () => {}),
    };
    vi.spyOn(fsp, 'stat').mockImplementation(async () => ({ ...metadata }) as never);
    vi.spyOn(fsp, 'open').mockResolvedValue(handle as never);
    return { metadata, handle };
  }

  it('rejects a synthetic oversized stat before opening or allocating the file', async () => {
    const { handle } = file(EXECUTION_READ_LIMITS.fileBytes + 1);
    await expect(withExecutionReadBudget(b => b.hash('synthetic'))).rejects.toThrow('单文件');
    expect(fsp.open).not.toHaveBeenCalled();
    expect(handle.read).not.toHaveBeenCalled();
  });

  it('hashes exact-limit legitimate bytes in chunks no larger than 64 KiB', async () => {
    const size = 128 * 1024 + 7;
    const { handle } = file(size);
    const digest = await withExecutionReadBudget(b => b.hash('synthetic'), { limits: { fileBytes: size, totalBytes: size } });
    expect(digest).toBe(createHash('sha256').update(Buffer.alloc(size, 97)).digest('hex'));
    expect(handle.read.mock.calls.map(call => call[2])).toEqual([65536, 65536, 7]);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('shares the total byte budget across files', async () => {
    const { handle } = file(8);
    await expect(withExecutionReadBudget(async b => {
      await b.hash('first');
      return b.hash('second');
    }, { limits: { totalBytes: 12 } })).rejects.toThrow('累计');
    expect(handle.read).toHaveBeenCalledOnce();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it.each(['growth', 'truncation', 'error', 'nonregular'])('fails closed on %s and closes an opened handle', async kind => {
    const { metadata, handle } = file();
    if (kind === 'nonregular') metadata.isFile = () => false;
    else handle.read.mockImplementationOnce(async buffer => {
      if (kind === 'error') throw Object.assign(new Error('synthetic EIO'), { code: 'EIO' });
      if (kind === 'growth') metadata.size++;
      return { bytesRead: kind === 'truncation' ? 0 : 8, buffer };
    });
    await expect(withExecutionReadBudget(b => b.hash('synthetic'))).rejects.toThrow();
    expect(handle.close).toHaveBeenCalledTimes(kind === 'nonregular' ? 0 : 1);
  });

  it('preserves missing optional files but rejects permission and I/O errors', async () => {
    const stat = vi.spyOn(fsp, 'stat');
    stat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(withExecutionReadBudget(b => b.hash('optional'))).resolves.toBe('missing');
    for (const code of ['EACCES', 'EIO']) {
      stat.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      await expect(withExecutionReadBudget(b => b.hash('optional'))).rejects.toThrow(code);
    }
  });

  it('counts repeated and ignored arguments before deduplication', async () => {
    const candidate = profile();
    const realpath = vi.spyOn(fsp, 'realpath');
    for (const argument of ['same.js', '--ignored', 'ordinary']) {
      candidate.services[0].args = Array(EXECUTION_READ_LIMITS.candidates + 1).fill(argument);
      await expect(createExecutionConfigurationFingerprint(candidate, 'E:/synthetic')).rejects.toThrow('候选数量');
    }
    expect(realpath).not.toHaveBeenCalled();
  });

  it('rejects pre-cancelled reads without filesystem access', async () => {
    const { handle } = file();
    const controller = new AbortController();
    controller.abort();
    await expect(withExecutionReadBudget(b => b.hash('synthetic'), { signal: controller.signal })).rejects.toThrow();
    expect(handle.read).not.toHaveBeenCalled();
  });

  it('preserves directory arguments and excludes symlink escapes without reading them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-approval-directory-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-approval-outside-'));
    try {
      fs.mkdirSync(path.join(root, 'web'));
      fs.mkdirSync(path.join(root, 'web', 'dist'));
      fs.writeFileSync(path.join(outside, 'external.js'), 'outside');
      fs.symlinkSync(outside, path.join(root, 'web', 'linked'), 'junction');
      const candidate = profile();
      candidate.services[0].args = ['--prefix', './dist', 'run', 'dev', './linked/external.js'];
      const before = await createExecutionConfigurationFingerprint(candidate, root);
      fs.writeFileSync(path.join(outside, 'external.js'), 'outside changed');
      expect(await createExecutionConfigurationFingerprint(candidate, root)).toBe(before);
      candidate.services[0].args = ['--prefix', './dist', 'run', 'other'];
      expect(await createExecutionConfigurationFingerprint(candidate, root)).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(['cancel', 'timeout'])('returns on %s while closing the handle when pending I/O settles', async kind => {
    const { handle } = file();
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    handle.read.mockImplementationOnce(async buffer => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return { bytesRead: 8, buffer };
    });
    const controller = new AbortController();
    const result = withExecutionReadBudget(b => b.hash('synthetic'), {
      signal: controller.signal, limits: { timeoutMs: kind === 'timeout' ? 25 : 1000 },
    });
    const rejected = expect(result).rejects.toThrow(kind === 'timeout' ? '超时' : '取消');
    await reading;
    if (kind === 'cancel') controller.abort();
    await rejected;
    expect(handle.close).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
  });

  it('bounds concurrent jobs including cancelled jobs with pending I/O', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    const first = withExecutionReadBudget(async b => { await pending; b.check(); }, { signal: controller.signal });
    const second = withExecutionReadBudget(async () => pending);
    const rejected = expect(first).rejects.toThrow('取消');
    controller.abort();
    await rejected;
    await expect(withExecutionReadBudget(async () => {})).rejects.toThrow('校验忙');
    release();
    await second;
    await expect(withExecutionReadBudget(async () => 'recovered')).resolves.toBe('recovered');
  });
});
