import { z } from 'zod';
import type { LogEntryDto, RunSessionDto } from './runner.js';
const time = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const HistoryQuerySchema = z.object({
  projectId: z.string().uuid().optional(), profileName: z.string().max(100).optional(),
  serviceName: z.string().max(100).optional(),
  status: z.enum(['STARTING','RUNNING','STOPPING','STOPPED','PARTIAL_FAILED','FAILED','INTERRUPTED']).optional(),
  from: time.optional(), to: time.optional(),
  cursor: z.object({ startedAt: z.string().max(100), id: z.string().uuid() }).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).refine(v => !v.from || !v.to || v.from <= v.to, '起始时间不能晚于结束时间');
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export interface HistoryPage { sessions: RunSessionDto[]; nextCursor?: { startedAt: string; id: string } }
export const StoredLogQuerySchema = z.object({
  runSessionId: z.string().uuid(), serviceSessionId: z.string().max(128).optional(),
  stream: z.enum(['stdout','stderr','system']).optional(), keyword: z.string().max(200).optional(),
  from: time.optional(), to: time.optional(), cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine(v => !v.from || !v.to || v.from <= v.to, '起始时间不能晚于结束时间');
export type StoredLogQuery = z.infer<typeof StoredLogQuerySchema>;
export interface StoredLogPage {
  entries: LogEntryDto[]; nextCursor?: string; snapshotAt: string;
  scannedBytes: number; skippedRecords: number; missingFiles: number; truncatedEntries: number;
  fileLimitReached: boolean; retentionDays: number; retentionMb: number; droppedEntries: number;
  firstTimestamp?: string; lastTimestamp?: string;
  storageError?: string;
}
