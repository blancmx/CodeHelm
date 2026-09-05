import { ipcMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@codehelm/contracts';

const harness = vi.hoisted(() => {
  const projectId = '00000000-0000-4000-8000-000000000002';
  const profileId = '00000000-0000-4000-8000-000000000001';
  let storedProfile: any = null;
  const saveCalls: any[] = [];
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^cipher:/, '')),
  };

  class MockProfileRepository {
    constructor(_db: unknown) {}

    findById(id: string) {
      return storedProfile?.id === id ? structuredClone(storedProfile) : null;
    }

    findByProjectId(id: string) {
      return storedProfile?.projectId === id ? [structuredClone(storedProfile)] : [];
    }

    save(input: any) {
      const saved = {
        ...input,
        id: input.id ?? profileId,
        isDefault: input.isDefault ?? true,
        createdAt: storedProfile?.createdAt ?? '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        services: input.services.map((service: any) => ({ ...service, runProfileId: input.id ?? profileId })),
      };
      saveCalls.push(structuredClone(saved));
      storedProfile = structuredClone(saved);
      return structuredClone(saved);
    }
  }

  return {
    projectId,
    profileId,
    saveCalls,
    handlers,
    safeStorage,
    MockProfileRepository,
    get storedProfile() {
      return storedProfile;
    },
    set storedProfile(value: any) {
      storedProfile = value;
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      harness.handlers.set(channel, handler);
    },
  },
  safeStorage: harness.safeStorage,
}));
vi.mock('@codehelm/database', () => ({
  ProfileRepository: harness.MockProfileRepository,
}));

import { registerProfileHandlers } from '../profile-handlers.js';

registerProfileHandlers(ipcMain.handle, {} as never);

function handler(channel: string) {
  const selected = harness.handlers.get(channel);
  if (!selected) throw new Error(`Missing IPC handler: ${channel}`);
  return selected;
}

function service(env: any[]) {
  return {
    id: 'service-1',
    runProfileId: harness.profileId,
    name: 'Web',
    type: 'frontend',
    moduleRelativePath: '.',
    executable: 'npm',
    args: ['run', 'dev'],
    cwdRelative: '',
    env,
    dependsOn: [],
    enabled: true,
    source: 'manual',
  };
}

describe('profile IPC secret boundary', () => {
  it('does not return secret plaintext and preserves/replaces it through save', async () => {
    const save = handler(IpcChannels.PROFILES_SAVE);
    const list = handler(IpcChannels.PROFILES_LIST);
    const get = handler(IpcChannels.PROFILES_GET);
    const initialInput = {
      projectId: harness.projectId,
      name: 'Development',
      failurePolicy: 'block_dependents',
      services: [service([
        { key: 'PORT', value: '3000' },
        { key: 'API_TOKEN', value: 'first-secret', isSecret: true },
      ])],
    };

    const created: any = await save({}, initialInput);
    expect(JSON.stringify(created)).not.toContain('first-secret');
    expect(created.services[0].env).toEqual([
      { key: 'PORT', value: '3000' },
      { key: 'API_TOKEN', value: '', isSecret: true, isRedacted: true },
    ]);
    expect(JSON.stringify(harness.storedProfile)).not.toContain('first-secret');

    const storedSecret = harness.storedProfile.services[0].env[1].value;
    expect(storedSecret).toContain('codehelm-secret-v1:');

    const unchanged: any = await save({}, created);
    expect(harness.safeStorage.decryptString(harness.storedProfile.services[0].env[1].value
      .replace('codehelm-secret-v1:', '')
      .length
      ? Buffer.from(harness.storedProfile.services[0].env[1].value.replace('codehelm-secret-v1:', ''), 'base64')
      : Buffer.from('')).toString()).toBe('first-secret');
    expect(unchanged.services[0].env[1].value).toBe('');

    const replaced: any = await save({}, {
      ...unchanged,
      services: [service([
        { key: 'PORT', value: '3001' },
        { key: 'API_TOKEN', value: 'second-secret', isSecret: true },
      ])],
    });
    expect(JSON.stringify(replaced)).not.toContain('second-secret');
    expect(JSON.stringify(harness.storedProfile)).not.toContain('second-secret');
    expect(harness.safeStorage.decryptString(Buffer.from(
      harness.storedProfile.services[0].env[1].value.replace('codehelm-secret-v1:', ''),
      'base64'
    ))).toBe('second-secret');

    await expect(save({}, {
      ...replaced,
      services: [service([{ key: 'API_TOKEN', value: 'downgrade', isSecret: false }])],
    })).rejects.toThrow('不能取消现有秘密环境变量的保护');

    await expect(save({}, {
      ...replaced,
      projectId: '00000000-0000-4000-8000-000000000003',
    })).rejects.toThrow('启动方案不属于指定项目');

    await expect(list({}, harness.projectId)).resolves.toEqual([replaced]);
    await expect(get({}, harness.profileId)).resolves.toEqual(replaced);
  });

  it('migrates a legacy plaintext secret before returning a redacted profile', async () => {
    harness.storedProfile = {
      id: harness.profileId,
      projectId: harness.projectId,
      name: 'Legacy',
      isDefault: true,
      failurePolicy: 'block_dependents',
      services: [service([{ key: 'API_TOKEN', value: 'legacy-secret', isSecret: true }])],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const result: any = await handler(IpcChannels.PROFILES_GET)({}, harness.profileId);
    expect(JSON.stringify(result)).not.toContain('legacy-secret');
    expect(result.services[0].env[0]).toMatchObject({ value: '', isSecret: true, isRedacted: true });
    expect(harness.storedProfile.services[0].env[0].value).toContain('codehelm-secret-v1:');
  });
});
