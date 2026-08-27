import { ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunProfileDtoSchema,
  SaveRunProfileInputSchema,
} from '@codehelm/contracts';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { ProfileRepository } from '@codehelm/database';
import {
  decryptSecretValue,
  encryptProfileSecrets,
  protectProfileSecrets,
  redactProfileSecrets,
} from './profile-secrets.js';

export function registerProfileHandlers(db: DatabaseInstance) {
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
              return { key: entry.key, value: entry.value, isSecret: entry.isSecret };
            }
            if (!entry.isRedacted) {
              return { key: entry.key, value: entry.value, isSecret: true };
            }

            const previous = existingService?.env.find((candidate) => candidate.key === entry.key);
            if (!previous?.isSecret) {
              throw new Error('无法保留不存在的秘密环境变量，请重新设置该值。');
            }
            return {
              key: entry.key,
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

  ipcMain.handle(IpcChannels.PROFILES_SAVE, async (_event, rawInput) => {
    const input = SaveRunProfileInputSchema.parse(rawInput);
    const existing = input.id ? profileRepo.findById(input.id) : null;
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

  ipcMain.handle(IpcChannels.PROFILES_LIST, async (_event, projectId: string) => {
    return RunProfileDtoSchema.array().parse(
      profileRepo.findByProjectId(projectId).map(toRendererProfile)
    );
  });

  ipcMain.handle(IpcChannels.PROFILES_GET, async (_event, id: string) => {
    const profile = profileRepo.findById(id);
    return profile ? toRendererProfile(profile) : null;
  });
}
