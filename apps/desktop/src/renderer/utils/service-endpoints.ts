import type { ProcessStatus } from '@codehelm/contracts';

interface EndpointService {
  id: string;
  name: string;
  type?: string;
}

interface EndpointRuntime {
  status: ProcessStatus;
  port?: number;
}

export interface ServiceEndpoint {
  serviceId: string;
  name: string;
  port: number;
  url: string;
  status: ProcessStatus;
  statusLabel: string;
  canOpen: boolean;
  actionLabel: string;
  label: string;
  isPrimary: boolean;
}

const activeLabels: Partial<Record<ProcessStatus, string>> = {
  STARTING: '启动中',
  RUNNING: '运行中',
  STOPPING: '停止中',
  DEGRADED: '状态异常',
};

/** Prefer unresolved/transition states so one running child cannot imply all are ready. */
export function getProfileProcessStatus(
  services: readonly Pick<EndpointService, 'id'>[],
  statuses: ReadonlyMap<string, EndpointRuntime>,
): ProcessStatus {
  const current = new Set(services.map(service => statuses.get(service.id)?.status));
  const priority: ProcessStatus[] = ['ORPHANED', 'VERIFYING', 'STOPPING', 'FAILED', 'DEGRADED', 'STARTING', 'RUNNING', 'STOPPED'];
  return priority.find(status => current.has(status)) ?? 'IDLE';
}

/** A browser shortcut is not evidence of an HTTP response or a documentation route. */
export function getServiceEndpoint(
  service: EndpointService,
  runtime?: EndpointRuntime,
): ServiceEndpoint | undefined {
  // Service names are user text, not proof of a framework, protocol or /docs route.
  if (service.type !== 'frontend' && service.type !== 'backend') return undefined;
  if (!runtime || !activeLabels[runtime.status]) return undefined;
  const port = runtime.port;
  // A configured port may have been reallocated or never bound. Only use runtime data.
  if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return {
    serviceId: service.id,
    name: service.name,
    port,
    url: `http://localhost:${port}`,
    status: runtime.status,
    statusLabel: activeLabels[runtime.status]!,
    canOpen: runtime.status === 'RUNNING',
    actionLabel: '打开服务地址',
    label: `${service.name} (:${port})`,
    isPrimary: service.type === 'frontend',
  };
}

export function getServiceEndpoints(
  services: readonly EndpointService[],
  statuses: ReadonlyMap<string, EndpointRuntime>,
): ServiceEndpoint[] {
  return services.flatMap(service => {
    const endpoint = getServiceEndpoint(service, statuses.get(service.id));
    return endpoint ? [endpoint] : [];
  }).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}
