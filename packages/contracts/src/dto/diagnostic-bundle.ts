import { z } from 'zod';

export const DIAGNOSTIC_BUNDLE_MAX_BYTES = 1024 * 1024;
export const DiagnosticBundleInputSchema = z.object({
  runSessionId: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
}).strict().refine(input => Date.parse(input.from) <= Date.parse(input.to)
  && Date.parse(input.to) - Date.parse(input.from) <= 7 * 86400_000, '请选择不超过 7 天的有效时间范围。');
export type DiagnosticBundleInput = z.infer<typeof DiagnosticBundleInputSchema>;
export interface DiagnosticBundleEntry {
  id: string;
  label: string;
  content: string;
}
export interface DiagnosticBundlePreview {
  token: string;
  expiresAt: string;
  bytes: number;
  entries: DiagnosticBundleEntry[];
  warnings: string[];
}
export const DiagnosticBundleExportSchema = z.object({
  token: z.string().uuid(),
  selectedIds: z.array(z.string().max(40)).min(1).max(204),
}).strict();
