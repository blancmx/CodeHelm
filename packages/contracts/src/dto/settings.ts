import { z } from 'zod';

export const AppSettingsDtoSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  defaultTerminal: z.string().optional(),
  maxScanFiles: z.number().int().min(1000).max(50000).default(50000),
  maxLogRetentionDays: z.number().int().min(1).max(90).default(14),
  maxLogRetentionMb: z.number().int().min(50).max(5000).default(500),
  enableAnonymousTelemetry: z.boolean().default(false),
});
export type AppSettingsDto = z.infer<typeof AppSettingsDtoSchema>;

export const AppSettingsPatchSchema = AppSettingsDtoSchema.partial().strict();

export interface LogStorageStatusDto {
  available: boolean;
  directory: string;
  fileCount: number;
  totalBytes: number;
  pendingBytes: number;
  droppedEntries: number;
  lastError: string | null;
}

export interface LogCleanupResultDto {
  deletedCount: number;
  freedBytes: number;
}
