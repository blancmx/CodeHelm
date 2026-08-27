import { describe, expect, it, vi } from 'vitest';
import type { RunProfile } from '@codehelm/domain';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^cipher:/, '')),
}));

vi.mock('electron', () => ({ safeStorage: storage }));

import {
  decryptProfileSecrets,
  encryptProfileSecrets,
  protectProfileSecrets,
  redactProfileSecrets,
  REDACTED_SECRET_VALUE,
} from '../profile-secrets.js';

function profile(): RunProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000002',
    name: 'Development',
    isDefault: true,
    failurePolicy: 'block_dependents',
    services: [{
      id: 'service-1',
      runProfileId: '00000000-0000-4000-8000-000000000001',
      name: 'Web',
      type: 'frontend',
      moduleRelativePath: '.',
      executable: 'npm',
      args: ['run', 'dev'],
      cwdRelative: '',
      env: [
        { key: 'PORT', value: '3000' },
        { key: 'API_TOKEN', value: 'plain-token', isSecret: true },
      ],
      dependsOn: [],
      enabled: true,
      source: 'manual',
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('profile secret protection', () => {
  it('encrypts secrets for storage and decrypts them only for main-process use', () => {
    const stored = encryptProfileSecrets(profile());
    const storedSecret = stored.services[0].env[1].value;

    expect(storedSecret).not.toContain('plain-token');
    expect(protectProfileSecrets(stored).changed).toBe(false);
    expect(decryptProfileSecrets(stored).services[0].env[1].value).toBe('plain-token');
  });

  it('masks secret values without exposing fragments to the renderer', () => {
    const redacted = redactProfileSecrets(encryptProfileSecrets(profile()));
    const env = redacted.services[0].env;

    expect(env[0]).toMatchObject({ key: 'PORT', value: '3000' });
    expect(env[1]).toMatchObject({
      key: 'API_TOKEN',
      value: REDACTED_SECRET_VALUE,
      isSecret: true,
      isRedacted: true,
    });
    expect(JSON.stringify(redacted)).not.toContain('plain-token');
  });

  it('protects legacy plaintext secret rows exactly once', () => {
    const legacy = profile();
    const result = protectProfileSecrets(legacy);

    expect(result.changed).toBe(true);
    expect(result.profile.services[0].env[1].value).not.toContain('plain-token');
    expect(protectProfileSecrets(result.profile).changed).toBe(false);
  });

  it('re-encrypts a legacy value that only resembles the storage prefix', () => {
    const legacy = profile();
    const collidingValue = 'codehelm-secret-v1:not-a-base64-envelope';
    legacy.services[0].env[1].value = collidingValue;

    const result = protectProfileSecrets(legacy);
    expect(result.profile.services[0].env[1].value).not.toBe(collidingValue);
    expect(decryptProfileSecrets(result.profile).services[0].env[1].value).toBe(collidingValue);
  });

  it('rejects malformed secret metadata instead of treating it as non-secret', () => {
    const malformed = profile();
    (malformed.services[0].env[1] as { isSecret?: unknown }).isSecret = null;

    expect(() => redactProfileSecrets(malformed)).toThrow('秘密环境变量标记无效');
  });

  it('fails closed when OS-backed encryption is unavailable', () => {
    storage.isEncryptionAvailable.mockReturnValueOnce(false);

    expect(() => encryptProfileSecrets(profile())).toThrow('系统安全存储不可用');
  });
});
