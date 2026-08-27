import { safeStorage } from 'electron';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import type { RunProfileDto } from '@codehelm/contracts';

const ENCRYPTED_SECRET_PREFIX = 'codehelm-secret-v1:';
export const REDACTED_SECRET_VALUE = '';

type ProfileWithServices = {
  services: ServiceConfig[];
};

function isSecretEntry(entry: { isSecret?: unknown }): boolean {
  if (entry.isSecret === true) return true;
  if (entry.isSecret === false || entry.isSecret === undefined) return false;
  throw new Error('秘密环境变量标记无效，已拒绝配置。');
}

function isValidBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function hasEncryptedSecretPrefix(value: string): boolean {
  return value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

function assertUniqueEnvironmentKeys(profile: ProfileWithServices): void {
  for (const service of profile.services) {
    const keys = new Set<string>();
    for (const entry of service.env) {
      if (keys.has(entry.key)) {
        throw new Error(`服务 ${service.name} 包含重复的环境变量键：${entry.key}`);
      }
      keys.add(entry.key);
    }
  }
}

function requireSafeStorage(): void {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法保存秘密环境变量。');
  }
}

export function isEncryptedSecretValue(value: string): boolean {
  return hasEncryptedSecretPrefix(value)
    && isValidBase64(value.slice(ENCRYPTED_SECRET_PREFIX.length));
}

export function encryptSecretValue(value: string): string {
  requireSafeStorage();
  try {
    return `${ENCRYPTED_SECRET_PREFIX}${safeStorage.encryptString(value).toString('base64')}`;
  } catch {
    throw new Error('秘密环境变量加密失败，未保存配置。');
  }
}

export function decryptSecretValue(value: string): string {
  if (!isEncryptedSecretValue(value)) {
    // Legacy rows are migrated by protectProfileSecrets before execution or
    // renderer exposure. Keep this branch for a lossless migration pass.
    return value;
  }

  try {
    const encoded = value.slice(ENCRYPTED_SECRET_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    throw new Error('保存的秘密环境变量无法解密，请重新设置该值。');
  }
}

/**
 * Encrypts legacy plaintext secret rows while leaving already protected rows
 * untouched. The returned object is safe to persist, but not safe to expose to
 * the renderer.
 */
export function protectProfileSecrets<T extends ProfileWithServices>(
  profile: T
): { profile: T; changed: boolean } {
  assertUniqueEnvironmentKeys(profile);
  let changed = false;
  const services = profile.services.map((service) => ({
    ...service,
    env: service.env.map((entry) => {
      const isSecret = isSecretEntry(entry);
      if (!isSecret) {
        return { ...entry };
      }
      if (isEncryptedSecretValue(entry.value)) {
        // Validate the envelope instead of trusting only its prefix. A valid
        // looking but undecryptable value fails closed in decryptSecretValue.
        decryptSecretValue(entry.value);
        return { ...entry, isSecret: true };
      }
      changed = true;
      return {
        key: entry.key,
        value: encryptSecretValue(entry.value),
        isSecret: true,
      };
    }),
  }));

  return {
    profile: { ...profile, services } as T,
    changed,
  };
}

/** Encrypt incoming renderer values. Existing redacted values are merged to plaintext before this call. */
export function encryptProfileSecrets<T extends ProfileWithServices>(profile: T): T {
  assertUniqueEnvironmentKeys(profile);
  const services = profile.services.map((service) => ({
    ...service,
    env: service.env.map((entry) => (
      isSecretEntry(entry)
        ? {
            key: entry.key,
            value: encryptSecretValue(entry.value),
            isSecret: true,
          }
        : { ...entry }
    )),
  }));

  return { ...profile, services } as T;
}

export function decryptProfileSecrets<T extends ProfileWithServices>(profile: T): T {
  assertUniqueEnvironmentKeys(profile);
  const services = profile.services.map((service) => ({
    ...service,
    env: service.env.map((entry) => (
      isSecretEntry(entry)
        ? {
            key: entry.key,
            value: decryptSecretValue(entry.value),
            isSecret: true,
          }
        : { ...entry }
    )),
  }));

  return { ...profile, services } as T;
}

export function redactProfileSecrets(profile: RunProfile): RunProfileDto {
  assertUniqueEnvironmentKeys(profile);
  return {
    ...profile,
    services: profile.services.map((service) => ({
      ...service,
      env: service.env.map((entry) => isSecretEntry(entry)
        ? {
            key: entry.key,
            value: REDACTED_SECRET_VALUE,
            isSecret: true,
            isRedacted: true,
          }
        : {
            key: entry.key,
            value: entry.value,
            ...(entry.isSecret === undefined ? {} : { isSecret: false }),
          }),
    })),
  } as RunProfileDto;
}
