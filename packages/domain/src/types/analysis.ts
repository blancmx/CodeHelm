export type TechnologyCategory =
  | 'frontend_framework'
  | 'backend_framework'
  | 'build_tool'
  | 'package_manager'
  | 'database'
  | 'testing'
  | 'tooling'
  | 'runtime'
  | 'language';

export type EvidenceType = 'manifest' | 'config' | 'import' | 'filename' | 'manual';

export interface Evidence {
  type: EvidenceType;
  filePath: string;
  detail: string;
  line?: number;
}

export interface DetectedTechnology {
  name: string;
  category: TechnologyCategory;
  versionRange?: string;
  confidence: number; // 0.0 - 1.0
  evidence: Evidence[];
  source: 'detected' | 'manual';
}

export type ModuleType = 'frontend' | 'backend' | 'fullstack' | 'tool' | 'unknown';

export interface ProjectModule {
  id: string;
  snapshotId: string;
  name: string;
  relativePath: string;
  moduleType: ModuleType;
  technologies: DetectedTechnology[];
  suggestedCommands?: SuggestedCommand[];
}

export interface SuggestedCommand {
  name: string;
  executable: string;
  args: string[];
  type: 'frontend' | 'backend' | 'tool' | 'auxiliary';
  confidence: number;
  source: string;
  port?: number;
}

export type AnalysisStatus = 'pending' | 'scanning' | 'completed' | 'failed' | 'cancelled';

export interface LanguageStat {
  language: string;
  fileCount: number;
  percentage: number;
}

export interface AnalysisSnapshot {
  id: string;
  projectId: string;
  analyzerVersion: string;
  status: AnalysisStatus;
  primaryLanguage: string;
  languages: LanguageStat[];
  modules: ProjectModule[];
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}
