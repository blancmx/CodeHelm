export interface Project {
  id: string;
  name: string;
  rootPath: string;
  realPathHash?: string;
  description?: string;
  color?: string;
  icon?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastAnalyzedAt?: string;
  lastRunAt?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  tags: string[];
  color?: string;
  icon?: string;
  primaryLanguages: string[];
  primaryFrameworks: string[];
  moduleCount: number;
  serviceCount: number;
  lastRunAt?: string;
  lastRunStatus?: string;
}
