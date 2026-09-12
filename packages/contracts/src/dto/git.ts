export interface GitSummaryDto {
  status: 'ready' | 'not_repository' | 'git_unavailable' | 'unsupported' | 'timeout' | 'unknown';
  checkedAt: string;
  message?: string;
  repositoryRoot?: string;
  branch?: string;
  detached?: boolean;
  unborn?: boolean;
  changedFiles?: number;
  stagedFiles?: number;
  unstagedFiles?: number;
  untrackedFiles?: number;
  conflictedFiles?: number;
  latestCommit?: { hash: string; subject: string };
}
