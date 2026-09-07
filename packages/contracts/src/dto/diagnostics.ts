import { z } from 'zod';

export const ENVIRONMENT_PREFLIGHT_ERROR = 'CODEHELM_ENVIRONMENT_PREFLIGHT';

export const RuntimeFamilySchema = z.enum(['node', 'python', 'java']);
export type RuntimeFamily = z.infer<typeof RuntimeFamilySchema>;
export const RuntimeProbeInputSchema = z.object({ profileId: z.string().uuid(), family: RuntimeFamilySchema }).strict();
export interface RuntimeServiceMatchDto {
  serviceId: string;
  serviceName: string;
  commandMatch: 'matched' | 'different' | 'unknown';
  requirementStatus: 'satisfied' | 'unsatisfied' | 'unspecified' | 'unknown';
  requirement?: string;
  source?: string;
  detail: string;
}
export interface RuntimeProbeDto {
  family: RuntimeFamily;
  executablePath: string;
  sha256: string;
  version: string | null;
  checkedAt: string;
  services: RuntimeServiceMatchDto[];
}

export const DiagnoseProfileInputSchema = z.object({ profileId: z.string().uuid() }).strict();
export const DiagnosticStatusSchema = z.enum(['passed', 'warning', 'blocked', 'unknown', 'not_applicable']);
export type DiagnosticStatus = z.infer<typeof DiagnosticStatusSchema>;

export const DiagnosticCheckDtoSchema = z.object({
  code: z.string(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  title: z.string(),
  status: DiagnosticStatusSchema,
  detail: z.string(),
  suggestion: z.string(),
});
export type DiagnosticCheckDto = z.infer<typeof DiagnosticCheckDtoSchema>;

export const ProfileDiagnosticsDtoSchema = z.object({
  profileId: z.string().uuid(),
  projectId: z.string().uuid(),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  fingerprint: z.string(),
  checks: z.array(DiagnosticCheckDtoSchema),
});
export type ProfileDiagnosticsDto = z.infer<typeof ProfileDiagnosticsDtoSchema>;
