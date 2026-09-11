import type { ProjectSummaryDto } from '@codehelm/contracts';
export function matchesOrganization(project: ProjectSummaryDto, scope: string, favorites: boolean, tags: string[]): boolean {
  return (scope === 'all' || !!project.archived === (scope === 'archived'))
    && (!favorites || !!project.favorite) && tags.every(tag => project.tags.includes(tag));
}
export function compareLastRun(a: ProjectSummaryDto, b: ProjectSummaryDto): number {
  return (b.lastRunAt || '').localeCompare(a.lastRunAt || '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export async function runOrganizationBatch<T>(items: T[], cancelled: () => boolean, update: (item: T) => Promise<unknown>, report: (item: T, status: string) => void): Promise<void> {
  for (const item of items) {
    if (cancelled()) { report(item, '未执行（已取消）'); continue; }
    try {
      if (!await update(item)) throw new Error('项目已移除');
      report(item, '已完成');
    } catch (error) { report(item, `失败：${error instanceof Error ? error.message : String(error)}`); }
  }
}
