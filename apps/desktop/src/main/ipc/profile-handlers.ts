import type { RegisterIpcHandler } from './trusted-ipc.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunProfileDtoSchema,
  SaveRunProfileInputSchema,
} from '@codehelm/contracts';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { validateProfileServices } from '@codehelm/domain';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProfileRepository } from '@codehelm/database';
import {
  decryptSecretValue,
  encryptProfileSecrets,
  protectProfileSecrets,
  redactProfileSecrets,
} from './profile-secrets.js';

export function registerProfileHandlers(handle: RegisterIpcHandler, db: DatabaseInstance, assertRemovable: (id: string) => void = () => {}) {
  const profileRepo = new ProfileRepository(db);

  function mergeRedactedSecrets(input: ReturnType<typeof SaveRunProfileInputSchema.parse>, existing: RunProfile | null) {
    return {
      ...input,
      services: input.services.map((service) => {
        const existingService = existing?.services.find((entry) => entry.id === service.id);
        return {
          ...service,
          env: service.env.map((entry) => {
            if (entry.isRedacted && entry.isSecret !== true) {
              throw new Error('秘密环境变量标记无效，已拒绝配置。');
            }
            if (!entry.isSecret) {
              const previous = existingService?.env.find((candidate) => candidate.key === entry.key);
              if (previous?.isSecret === true) {
                throw new Error('不能取消现有秘密环境变量的保护，请删除该变量或设置新的秘密值。');
              }
              return { key: entry.key, ...(entry.required === undefined ? {} : { required: entry.required }), value: entry.value, isSecret: entry.isSecret };
            }
            if (!entry.isRedacted) {
              return { key: entry.key, ...(entry.required === undefined ? {} : { required: entry.required }), value: entry.value, isSecret: true };
            }

            const previous = existingService?.env.find((candidate) => candidate.key === entry.key);
            if (!previous?.isSecret) {
              throw new Error('无法保留不存在的秘密环境变量，请重新设置该值。');
            }
            return {
              key: entry.key, ...(entry.required === undefined ? {} : { required: entry.required }),
              value: decryptSecretValue(previous.value),
              isSecret: true,
            };
          }),
        };
      }),
    };
  }

  function protectStoredProfile(profile: RunProfile): RunProfile {
    const protectedResult = protectProfileSecrets(profile);
    if (!protectedResult.changed) return protectedResult.profile;

    return profileRepo.save({
      id: protectedResult.profile.id,
      projectId: protectedResult.profile.projectId,
      name: protectedResult.profile.name,
      description: protectedResult.profile.description,
      isDefault: protectedResult.profile.isDefault,
      failurePolicy: protectedResult.profile.failurePolicy,
      services: protectedResult.profile.services,
      userConfirmedAt: protectedResult.profile.userConfirmedAt,
    });
  }

  function toRendererProfile(profile: RunProfile) {
    return RunProfileDtoSchema.parse(redactProfileSecrets(protectStoredProfile(profile)));
  }

  handle(IpcChannels.PROFILES_SAVE, async (_event, rawInput) => {
    const input = SaveRunProfileInputSchema.parse(rawInput);
    const errors = validateProfileServices(input.services);
    if (errors.length) throw new Error(errors.join('\n'));
    const existing = input.id ? profileRepo.findById(input.id) : null;
    if (input.id && !existing && db.prepare('SELECT 1 FROM run_profiles WHERE id=? AND deleted_at IS NOT NULL').get(input.id)) {
      throw new Error('方案已删除，请刷新后重试。');
    }
    if (existing && existing.projectId !== input.projectId) {
      throw new Error('启动方案不属于指定项目，已拒绝保存。');
    }
    const protectedExisting = existing ? protectStoredProfile(existing) : null;
    const merged = mergeRedactedSecrets(input, protectedExisting);
    const profileToStore = encryptProfileSecrets({
      id: merged.id,
      projectId: merged.projectId,
      name: merged.name,
      description: merged.description,
      isDefault: merged.isDefault,
      failurePolicy: merged.failurePolicy,
      services: merged.services as ServiceConfig[],
      userConfirmedAt: merged.userConfirmedAt,
    });
    const savedProfile = profileRepo.save({
      ...profileToStore,
    });
    return toRendererProfile(savedProfile);
  });

  handle(IpcChannels.PROFILES_LIST, async (_event, projectId: string) => {
    return RunProfileDtoSchema.array().parse(
      profileRepo.findByProjectId(projectId).map(toRendererProfile)
    );
  });

  handle(IpcChannels.PROFILES_GET, async (_event, id: string) => {
    const profile = profileRepo.findById(id);
    return profile ? toRendererProfile(profile) : null;
  });

  handle(IpcChannels.PROFILES_COPY, async (_event, rawId: unknown, rawName: unknown) => {
    const id = z.string().uuid().parse(rawId);
    const name = z.string().trim().min(1).max(100).parse(rawName);
    const existing = profileRepo.findById(id);
    if (!existing) throw new Error('方案不存在或已删除。');
    const source = protectStoredProfile(existing);
    const profileId = randomUUID();
    const ids = new Map(source.services.map(service => [service.id, randomUUID()]));
    const services = source.services.map(service => ({ ...service, id: ids.get(service.id)!, runProfileId: profileId,
      dependsOn: service.dependsOn.map(dep => ids.get(dep) ?? dep) }));
    return toRendererProfile(profileRepo.save({ ...source, id: profileId, name, isDefault: false, userConfirmedAt: undefined, services }));
  });

  handle(IpcChannels.PROFILES_REMOVE, async (_event, rawId: unknown) => {
    const id = z.string().uuid().parse(rawId);
    assertRemovable(id);
    profileRepo.remove(id);
  });
}
