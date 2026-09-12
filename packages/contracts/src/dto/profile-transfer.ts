import { z } from 'zod';
import { ServiceConfigDtoSchema, HealthCheckConfigDtoSchema } from './profiles.js';

export const PROFILE_TRANSFER_MAX_BYTES = 256 * 1024;
export const ProfileTemplateSchema = z.object({
  format: z.literal('codehelm.run-profile'),
  version: z.literal(1),
  name: z.string().trim().min(1).max(100),
  failurePolicy: z.enum(['continue', 'block_dependents', 'rollback_all']),
  services: z.array(ServiceConfigDtoSchema.omit({ runProfileId: true, source: true }).extend({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    args: z.array(z.string().max(8192)).max(200),
    dependsOn: z.array(z.string().min(1).max(100)).max(100),
    port: z.number().int().min(1).max(65535).optional(),
    startTimeoutMs: z.number().int().min(1).max(600000).optional(),
    stopTimeoutMs: z.number().int().min(1).max(600000).optional(),
    env: z.array(z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), value: z.string(), isSecret: z.boolean(), required: z.boolean() }).strict()).max(100),
    healthCheck: HealthCheckConfigDtoSchema.extend({
      port: z.number().int().min(1).max(65535).optional(),
      expectedStatus: z.number().int().min(100).max(599).optional(),
      intervalMs: z.number().int().min(1).max(600000).optional(),
      timeoutMs: z.number().int().min(1).max(600000).optional(),
      retries: z.number().int().min(0).max(1000).optional(),
    }).strict().optional(),
  }).strict()).max(100),
}).strict();
export type ProfileTemplate = z.infer<typeof ProfileTemplateSchema>;
export interface ProfileTemplateInspection { template: ProfileTemplate; variables: string[] }
export interface ProfileImportPreview {
  token: string;
  name: string;
  projectName: string;
  existingNames: string[];
  services: Array<{ name: string; executable: string; argumentCount: number; argumentsPreview: string[]; readiness: string; cwdRelative: string; dependencyNames: string[]; variableNames: string[] }>;
}
export interface ProfileImportInput { projectId: string; name: string; text: string; values: Record<string, string> }
