import { z } from 'zod';

export const ProcessStatusSchema = z.enum([
  'IDLE',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'DEGRADED',
  'FAILED',
  'VERIFYING',
  'ORPHANED',
]);
export type ProcessStatus = z.infer<typeof ProcessStatusSchema>;

export const ProcessFingerprintDtoSchema = z.object({
  pid: z.number(),
  startTime: z.number(),
  executable: z.string(),
  cwd: z.string(),
  argsSummary: z.string(),
});

export const ServiceSessionDtoSchema = z.object({
  id: z.string(),
  runSessionId: z.string(),
  serviceConfigId: z.string(),
  serviceName: z.string(),
  serviceType: z.string(),
  status: ProcessStatusSchema,
  pid: z.number().optional(),
  fingerprint: ProcessFingerprintDtoSchema.optional(),
  port: z.number().optional(),
  exitCode: z.number().optional(),
  exitSignal: z.string().optional(),
  errorMessage: z.string().optional(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
});
export type ServiceSessionDto = z.infer<typeof ServiceSessionDtoSchema>;

export const RunSessionDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  runProfileId: z.string().uuid(),
  status: z.enum(['STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'PARTIAL_FAILED', 'FAILED']),
  services: z.array(ServiceSessionDtoSchema),
  startedAt: z.string(),
  stoppedAt: z.string().optional(),
});
export type RunSessionDto = z.infer<typeof RunSessionDtoSchema>;

export const ServiceStatusEventDtoSchema = z.object({
  projectId: z.string(),
  runSessionId: z.string(),
  serviceSessionId: z.string(),
  serviceConfigId: z.string(),
  serviceName: z.string(),
  status: ProcessStatusSchema,
  pid: z.number().optional(),
  port: z.number().optional(),
  errorMessage: z.string().optional(),
  exitCode: z.number().optional(),
});
export type ServiceStatusEventDto = z.infer<typeof ServiceStatusEventDtoSchema>;

export const LogEntryDtoSchema = z.object({
  id: z.string(),
  serviceSessionId: z.string(),
  serviceName: z.string(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  message: z.string(),
  timestamp: z.string(),
});
export type LogEntryDto = z.infer<typeof LogEntryDtoSchema>;

export const LogBatchDtoSchema = z.object({
  projectId: z.string(),
  runSessionId: z.string(),
  entries: z.array(LogEntryDtoSchema),
});
export type LogBatchDto = z.infer<typeof LogBatchDtoSchema>;
