import { z } from 'zod';

export const HealthCheckConfigDtoSchema = z.object({
  type: z.enum(['none', 'tcp', 'http', 'log_regex']),
  port: z.number().optional(),
  httpPath: z.string().optional(),
  expectedStatus: z.number().optional(),
  logRegex: z.string().optional(),
  intervalMs: z.number().optional(),
  timeoutMs: z.number().optional(),
  retries: z.number().optional(),
});
export type HealthCheckConfigDto = z.infer<typeof HealthCheckConfigDtoSchema>;

export const ServiceEnvVarDtoSchema = z.object({
  key: z.string(),
  value: z.string(),
  isSecret: z.boolean().optional(),
});
export type ServiceEnvVarDto = z.infer<typeof ServiceEnvVarDtoSchema>;

export const ServiceConfigDtoSchema = z.object({
  id: z.string(),
  runProfileId: z.string(),
  name: z.string(),
  type: z.enum(['frontend', 'backend', 'auxiliary', 'tool']),
  moduleRelativePath: z.string(),
  executable: z.string(),
  args: z.array(z.string()),
  cwdRelative: z.string(),
  env: z.array(ServiceEnvVarDtoSchema),
  port: z.number().optional(),
  portExtractRegex: z.string().optional(),
  healthCheck: HealthCheckConfigDtoSchema.optional(),
  dependsOn: z.array(z.string()),
  enabled: z.boolean(),
  source: z.enum(['detected', 'manual']),
  startTimeoutMs: z.number().optional(),
  stopTimeoutMs: z.number().optional(),
});
export type ServiceConfigDto = z.infer<typeof ServiceConfigDtoSchema>;

export const SaveRunProfileInputSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  name: z.string().min(1, 'Profile name required'),
  description: z.string().optional(),
  isDefault: z.boolean().default(true),
  failurePolicy: z.enum(['continue', 'block_dependents', 'rollback_all']),
  services: z.array(ServiceConfigDtoSchema),
  userConfirmedAt: z.string().optional(),
});
export type SaveRunProfileInput = z.infer<typeof SaveRunProfileInputSchema>;

export const RunProfileDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
  failurePolicy: z.enum(['continue', 'block_dependents', 'rollback_all']),
  services: z.array(ServiceConfigDtoSchema),
  userConfirmedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RunProfileDto = z.infer<typeof RunProfileDtoSchema>;
