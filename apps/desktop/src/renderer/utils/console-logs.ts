import type { LogEntryDto } from '@codehelm/contracts';

export function resolveLogProjectId(
  entry: LogEntryDto,
  serviceToProject: ReadonlyMap<string, string>
): string | undefined {
  if (entry.serviceSessionId && serviceToProject.has(entry.serviceSessionId)) {
    return serviceToProject.get(entry.serviceSessionId);
  }
  return entry.serviceName ? serviceToProject.get(entry.serviceName) : undefined;
}

// Resolve each log once, rather than scanning the entire buffer for every project tab.
export function countLogsByProject(
  logs: readonly LogEntryDto[],
  serviceToProject: ReadonlyMap<string, string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of logs) {
    const projectId = resolveLogProjectId(entry, serviceToProject);
    if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  return counts;
}

export function resolveDisplayedLogs<T>(live: readonly T[], frozen: readonly T[] | null): readonly T[] {
  return frozen ?? live;
}

export function hasBufferedLogEntries<T extends { id: string }>(
  live: readonly T[],
  frozen: readonly T[] | null
): boolean {
  return frozen !== null && frozen.at(-1)?.id !== live.at(-1)?.id;
}
