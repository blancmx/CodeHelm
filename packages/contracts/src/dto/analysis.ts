import { z } from 'zod';

export const TechnologyCategorySchema = z.enum([
  'frontend_framework',
  'backend_framework',
  'build_tool',
  'package_manager',
  'database',
  'testing',
  'tooling',
  'runtime',
  'language',
]);

export const EvidenceSchema = z.object({
  type: z.enum(['manifest', 'config', 'import', 'filename', 'manual']),
  filePath: z.string(),
  detail: z.string(),
  line: z.number().optional(),
});

export const DetectedTechnologyDtoSchema = z.object({
  name: z.string(),
  category: TechnologyCategorySchema,
  versionRange: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema),
  source: z.enum(['detected', 'manual']),
});
export type DetectedTechnologyDto = z.infer<typeof DetectedTechnologyDtoSchema>;

export const SuggestedCommandDtoSchema = z.object({
  name: z.string(),
  executable: z.string(),
  args: z.array(z.string()),
  type: z.enum(['frontend', 'backend', 'tool', 'auxiliary']),
  confidence: z.number(),
  source: z.string(),
  port: z.number().optional(),
});

export const ProjectModuleDtoSchema = z.object({
  id: z.string(),
  snapshotId: z.string(),
  name: z.string(),
  relativePath: z.string(),
  moduleType: z.enum(['frontend', 'backend', 'fullstack', 'tool', 'unknown']),
  technologies: z.array(DetectedTechnologyDtoSchema),
  suggestedCommands: z.array(SuggestedCommandDtoSchema).optional(),
});
export type ProjectModuleDto = z.infer<typeof ProjectModuleDtoSchema>;

export const LanguageStatDtoSchema = z.object({
  language: z.string(),
  fileCount: z.number(),
  percentage: z.number(),
});

export const AnalysisSnapshotDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analyzerVersion: z.string(),
  status: z.enum(['pending', 'scanning', 'completed', 'failed', 'cancelled']),
  primaryLanguage: z.string(),
  languages: z.array(LanguageStatDtoSchema),
  modules: z.array(ProjectModuleDtoSchema),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type AnalysisSnapshotDto = z.infer<typeof AnalysisSnapshotDtoSchema>;

export const AnalysisProgressDtoSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string(),
  stage: z.string(),
  scannedFiles: z.number(),
  totalFilesEstimate: z.number().optional(),
  percentage: z.number().min(0).max(100),
  currentFile: z.string().optional(),
});
export type AnalysisProgressDto = z.infer<typeof AnalysisProgressDtoSchema>;

export const AnalysisTaskDtoSchema = AnalysisProgressDtoSchema.extend({
  status: z.enum(['running', 'cancelling', 'saving', 'completed', 'failed', 'cancelled']),
  errorMessage: z.string().optional(),
});
export type AnalysisTaskDto = z.infer<typeof AnalysisTaskDtoSchema>;
