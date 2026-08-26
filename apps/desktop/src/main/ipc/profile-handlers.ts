import { ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  IpcChannels,
  RunProfileDtoSchema,
  SaveRunProfileInputSchema,
} from '@codehelm/contracts';
import { ProfileRepository } from '@codehelm/database';

export function registerProfileHandlers(db: DatabaseInstance) {
  const profileRepo = new ProfileRepository(db);

  ipcMain.handle(IpcChannels.PROFILES_SAVE, async (_event, rawInput) => {
    const input = SaveRunProfileInputSchema.parse(rawInput);
    const savedProfile = profileRepo.save({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      isDefault: input.isDefault,
      failurePolicy: input.failurePolicy,
      services: input.services as any,
      userConfirmedAt: input.userConfirmedAt,
    });
    return RunProfileDtoSchema.parse(savedProfile);
  });

  ipcMain.handle(IpcChannels.PROFILES_LIST, async (_event, projectId: string) => {
    return RunProfileDtoSchema.array().parse(profileRepo.findByProjectId(projectId));
  });

  ipcMain.handle(IpcChannels.PROFILES_GET, async (_event, id: string) => {
    return RunProfileDtoSchema.nullable().parse(profileRepo.findById(id));
  });
}
