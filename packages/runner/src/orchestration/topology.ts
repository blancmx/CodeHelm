import type { ServiceConfig } from '@codehelm/domain';
import { AppError, ErrorCode } from '@codehelm/shared';

export class CycleDetectedError extends AppError {
  constructor(public readonly cyclePath: string[]) {
    super(
      ErrorCode.CYCLE_DETECTED,
      `Detected circular dependency among services: ${cyclePath.join(' -> ')}`,
      { cyclePath }
    );
  }
}

/**
 * Detects if there is any cycle in the service dependency graph using DFS with 3-color graph coloring.
 * Returns the cycle path (array of service names) if found, or null if valid DAG.
 */
export function detectCycle(services: ServiceConfig[]): string[] | null {
  const serviceMap = new Map<string, ServiceConfig>();
  for (const s of services) {
    serviceMap.set(s.id, s);
  }

  // 0 = unvisited, 1 = visiting (in current DFS stack), 2 = visited
  const visited = new Map<string, number>();
  const parent = new Map<string, string>();

  function dfs(currId: string, stack: string[]): string[] | null {
    visited.set(currId, 1);
    stack.push(currId);

    const service = serviceMap.get(currId);
    if (service) {
      for (const depId of service.dependsOn) {
        if (!serviceMap.has(depId)) {
          // Dependency not in current service list, ignore
          continue;
        }

        const state = visited.get(depId) || 0;
        if (state === 1) {
          // Found cycle! Extract the cycle path
          const cycleIdx = stack.indexOf(depId);
          const cycleIds = stack.slice(cycleIdx);
          cycleIds.push(depId); // close the loop
          return cycleIds.map((id) => serviceMap.get(id)?.name || id);
        }

        if (state === 0) {
          parent.set(depId, currId);
          const cycle = dfs(depId, stack);
          if (cycle) return cycle;
        }
      }
    }

    stack.pop();
    visited.set(currId, 2);
    return null;
  }

  for (const s of services) {
    if (!visited.has(s.id) || visited.get(s.id) === 0) {
      const cycle = dfs(s.id, []);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * Topologically sorts services into sequential batches (layers) for parallel execution.
 * Services in the same layer can be started concurrently.
 */
export function topologicalSortServices(services: ServiceConfig[]): ServiceConfig[][] {
  const cycle = detectCycle(services);
  if (cycle) {
    throw new CycleDetectedError(cycle);
  }

  const enabledServices = services.filter((s) => s.enabled);
  if (enabledServices.length === 0) {
    return [];
  }

  const serviceMap = new Map<string, ServiceConfig>();
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // depId -> list of services that depend on it

  for (const s of enabledServices) {
    serviceMap.set(s.id, s);
    inDegree.set(s.id, 0);
    graph.set(s.id, []);
  }

  for (const s of enabledServices) {
    const validDeps = s.dependsOn.filter((depId) => serviceMap.has(depId));
    inDegree.set(s.id, validDeps.length);

    for (const depId of validDeps) {
      graph.get(depId)?.push(s.id);
    }
  }

  const batches: ServiceConfig[][] = [];
  let currentLayer = enabledServices.filter((s) => inDegree.get(s.id) === 0);

  while (currentLayer.length > 0) {
    batches.push(currentLayer);
    const nextLayer: ServiceConfig[] = [];

    for (const service of currentLayer) {
      const dependents = graph.get(service.id) || [];
      for (const depId of dependents) {
        const remaining = (inDegree.get(depId) || 1) - 1;
        inDegree.set(depId, remaining);
        if (remaining === 0) {
          const nextService = serviceMap.get(depId);
          if (nextService) {
            nextLayer.push(nextService);
          }
        }
      }
    }

    currentLayer = nextLayer;
  }

  return batches;
}
