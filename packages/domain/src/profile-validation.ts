import type { ServiceConfig } from './types/run-profile.js';

/** Shared save-time feedback; the main process always repeats this check. */
export function validateProfileServices(services: ServiceConfig[]): string[] {
  const errors: string[] = [];
  const byId = new Map(services.map(s => [s.id, s]));
  if (byId.size !== services.length || services.some(s => !s.id)) errors.push('服务标识重复或为空。');
  for (const service of services) {
    for (const id of new Set(service.dependsOn)) {
      const dependency = byId.get(id);
      if (!dependency) errors.push(`${service.name} 引用了不存在的依赖 ${id}。`);
      else if (service.enabled && !dependency.enabled) errors.push(`${service.name} 依赖的 ${dependency.name} 已停用。`);
    }
  }
  const done = new Set<string>(), visiting: string[] = [];
  function visit(id: string): void {
    const offset = visiting.indexOf(id);
    if (offset >= 0) {
      errors.push(`循环依赖：${[...visiting.slice(offset), id].map(key => byId.get(key)?.name ?? key).join(' → ')}`);
      return;
    }
    if (done.has(id)) return;
    visiting.push(id);
    for (const dep of new Set(byId.get(id)?.dependsOn ?? [])) if (byId.has(dep)) visit(dep);
    visiting.pop(); done.add(id);
  }
  for (const service of services) visit(service.id);
  return [...new Set(errors)];
}
