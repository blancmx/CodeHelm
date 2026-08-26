import { z } from 'zod';

export const AppSettingsDtoSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  defaultTerminal: z.string().optional(),
  maxScanFiles: z.number().default(50000),
  maxLogRetentionDays: z.number().default(14),
  maxLogRetentionMb: z.number().default(500),
  enableAnonymousTelemetry: z.boolean().default(false),
});
export type AppSettingsDto = z.infer<typeof AppSettingsDtoSchema>;
