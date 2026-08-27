import type {
  AnalysisSnapshot,
  DetectedTechnology,
  SuggestedCommand,
} from '@codehelm/domain';

export interface DiscoveryContext {
  projectRoot: string;
  /** Module root relative to projectRoot. All paths in files/manifests/configFiles remain project-relative. */
  moduleRelativePath?: string;
  files: string[];
  manifests: string[];
  configFiles: string[];
}

export interface AnalysisContext extends DiscoveryContext {
  readFile(relativePath: string): Promise<string>;
  readJson<T = unknown>(relativePath: string): Promise<T | null>;
  fileExists(relativePath: string): Promise<boolean>;
}

export interface DetectionResult {
  technology: DetectedTechnology;
  suggestedCommands?: SuggestedCommand[];
}

export interface Detector {
  readonly id: string;
  readonly name: string;
  supports(context: DiscoveryContext): boolean;
  detect(context: AnalysisContext): Promise<DetectionResult[]>;
}

export interface ProjectAnalyzer {
  analyze(projectRoot: string, onProgress?: AnalysisProgressCallback): Promise<AnalysisSnapshot>;
  cancel(): void;
}

export type AnalysisProgressCallback = (percent: number, stage: string, scannedFiles: number) => void;
