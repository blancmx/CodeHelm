import { z } from 'zod';

export const ImportProjectInputSchema = z.object({
  rootPath: z.string().min(1, 'Path cannot be empty'),
  name: z.string().optional(),
  tags: z.array(z.string()).default([]),
  color: z.string().optional(),
  icon: z.string().optional(),
});
export type ImportProjectInput = z.infer<typeof ImportProjectInputSchema>;

export const BatchImportInputSchema = z.object({
  projects: z.array(ImportProjectInputSchema).max(100, 'Too many projects in one import request'),
});
export type BatchImportInput = z.infer<typeof BatchImportInputSchema>;

export const WorkspaceScanInputSchema = z.object({
  rootPath: z.string().min(1).max(32768),
  maxDepth: z.number().int().min(0).max(4).default(2),
}).strict();
export type WorkspaceScanInput = z.infer<typeof WorkspaceScanInputSchema>;

export const DiscoveredProjectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  relativePath: z.string(),
  type: z.enum(['node', 'python', 'java', 'go', 'rust', 'static_html', 'unknown']),
  framework: z.string(),
  hasDependenciesInstalled: z.boolean(),
  missingDependencyType: z.enum(['node_modules', 'python_venv', 'none']),
  recommendedInstallCommand: z.string().optional(),
  recommendedRunCommand: z.string(),
  tags: z.array(z.string()),
  hasEnvExample: z.boolean(),
  hasEnv: z.boolean(),
  port: z.number().optional(),
});
export type DiscoveredProjectDto = z.infer<typeof DiscoveredProjectDtoSchema>;

export const ProjectDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rootPath: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAnalyzedAt: z.string().optional(),
  lastRunAt: z.string().optional(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const ProjectTaskProgressDtoSchema = z.object({
  taskId: z.string(),
  kind: z.enum(['scan', 'import']),
  status: z.enum(['running', 'cancelling', 'completed', 'partial', 'failed', 'cancelled']),
  stage: z.string(),
  completedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  scannedDirectories: z.number().int().nonnegative(),
  foundProjects: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  errorMessage: z.string().optional(),
});
export type ProjectTaskProgressDto = z.infer<typeof ProjectTaskProgressDtoSchema>;

export const ProjectImportResultDtoSchema = z.object({
  rootPath: z.string(),
  name: z.string(),
  project: ProjectDtoSchema.optional(),
  status: z.enum(['imported', 'completed', 'existing', 'failed', 'cancelled']),
  errorMessage: z.string().optional(),
});
export type ProjectImportResultDto = z.infer<typeof ProjectImportResultDtoSchema>;

export const ProjectTaskDtoSchema = ProjectTaskProgressDtoSchema.extend({
  discovered: z.array(DiscoveredProjectDtoSchema),
  results: z.array(ProjectImportResultDtoSchema),
});
export type ProjectTaskDto = z.infer<typeof ProjectTaskDtoSchema>;

export const ProjectSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rootPath: z.string(),
  tags: z.array(z.string()),
  color: z.string().optional(),
  icon: z.string().optional(),
  primaryLanguages: z.array(z.string()),
  primaryFrameworks: z.array(z.string()),
  moduleCount: z.number(),
  serviceCount: z.number(),
  lastRunAt: z.string().optional(),
  lastRunStatus: z.string().optional(),
  hasDependenciesInstalled: z.boolean().optional(),
  recommendedInstallCommand: z.string().optional(),
  recommendedRunCommand: z.string().optional(),
});
export type ProjectSummaryDto = z.infer<typeof ProjectSummaryDtoSchema>;

export const SelectedDirectoryDtoSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type SelectedDirectoryDto = z.infer<typeof SelectedDirectoryDtoSchema>;

export interface FileTreeNodeDto {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  children?: FileTreeNodeDto[];
}

export const ReadmeSummaryDtoSchema = z.object({
  hasReadme: z.boolean(),
  title: z.string(),
  description: z.string(),
  features: z.array(z.string()),
  rawExcerpt: z.string().optional(),
});
export type ReadmeSummaryDto = z.infer<typeof ReadmeSummaryDtoSchema>;
