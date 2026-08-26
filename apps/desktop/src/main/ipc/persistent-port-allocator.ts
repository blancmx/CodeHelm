import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { ServiceConfig } from '@codehelm/domain';
import { isPortAvailable } from '@codehelm/runner';

const PORT_ALLOCATOR_SETTINGS_KEY = 'port_allocator_v1';
const MAX_PORT = 65535;
const FAMILY_WINDOW = 500;

interface PortAllocatorState {
  cursors: Record<string, number>;
}

interface AssignedPortRow {
  projectId: string;
  type: string;
  port: number;
}

export interface AssignPersistentPortsInput {
  services: ServiceConfig[];
  existingServices?: ServiceConfig[];
  assignedPorts: AssignedPortRow[];
  state?: PortAllocatorState;
  isAvailable?: (port: number) => Promise<boolean>;
}

export interface AssignPersistentPortsResult {
  services: ServiceConfig[];
  state: PortAllocatorState;
}

function serviceIdentity(service: ServiceConfig): string {
  return `${service.moduleRelativePath}\u0000${service.name}\u0000${service.type}`;
}

function familyKey(service: ServiceConfig, preferredPort: number): string {
  return `${service.type}:${preferredPort}`;
}

function cloneWithPort(service: ServiceConfig, port: number): ServiceConfig {
  return {
    ...service,
    args: [...service.args],
    env: service.env.map((entry) => ({ ...entry })),
    dependsOn: [...service.dependsOn],
    port,
    healthCheck: service.healthCheck
      ? { ...service.healthCheck, port }
      : service.healthCheck,
  };
}

export async function assignPersistentPorts(
  input: AssignPersistentPortsInput
): Promise<AssignPersistentPortsResult> {
  const isAvailable = input.isAvailable ?? isPortAvailable;
  const existingByIdentity = new Map(
    (input.existingServices ?? []).map((service) => [serviceIdentity(service), service])
  );
  const used = new Set(
    input.assignedPorts.map((assignment) => assignment.port)
  );
  const state: PortAllocatorState = {
    cursors: { ...(input.state?.cursors ?? {}) },
  };
  const services: ServiceConfig[] = [];

  for (const service of input.services) {
    if (!service.port) {
      services.push(service);
      continue;
    }

    const existing = existingByIdentity.get(serviceIdentity(service));
    if (existing?.port) {
      const preserved = cloneWithPort(service, existing.port);
      services.push(preserved);
      used.add(existing.port);
      const key = familyKey(service, service.port);
      state.cursors[key] = Math.max(state.cursors[key] ?? service.port, existing.port + 1);
      continue;
    }

    const preferredPort = service.port;
    const key = familyKey(service, preferredPort);
    const nearbyHighWatermark = input.assignedPorts
      .filter((assignment) => (
        assignment.type === service.type
        && Math.abs(assignment.port - preferredPort) <= FAMILY_WINDOW
      ))
      .reduce((highest, assignment) => Math.max(highest, assignment.port + 1), preferredPort);
    let candidate = Math.max(preferredPort, state.cursors[key] ?? preferredPort, nearbyHighWatermark);
    let attempts = 0;

    while (candidate <= MAX_PORT && attempts < 2000) {
      if (!used.has(candidate) && await isAvailable(candidate)) break;
      candidate += 1;
      attempts += 1;
    }
    if (candidate > MAX_PORT || attempts >= 2000) {
      throw new Error(`无法为服务 ${service.name} 分配可用端口（起始端口 ${preferredPort}）`);
    }

    services.push(cloneWithPort(service, candidate));
    used.add(candidate);
    state.cursors[key] = candidate + 1;
  }

  return { services, state };
}

export class PersistentPortAllocator {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: DatabaseInstance) {}

  allocate(
    _projectId: string,
    services: ServiceConfig[],
    existingServices: ServiceConfig[] = []
  ): Promise<ServiceConfig[]> {
    const operation = this.queue.then(() => this.allocateNow(services, existingServices));
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async allocateNow(
    services: ServiceConfig[],
    existingServices: ServiceConfig[]
  ): Promise<ServiceConfig[]> {
    const rows = this.db.prepare(`
      SELECT rp.project_id AS projectId, sc.type, sc.port
      FROM service_configs sc
      JOIN run_profiles rp ON rp.id = sc.run_profile_id
      WHERE sc.port IS NOT NULL
    `).all() as AssignedPortRow[];
    const settingRow = this.db.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).get(PORT_ALLOCATOR_SETTINGS_KEY) as { value: string } | undefined;
    let state: PortAllocatorState = { cursors: {} };
    if (settingRow) {
      try {
        const parsed = JSON.parse(settingRow.value) as PortAllocatorState;
        if (parsed && typeof parsed.cursors === 'object') state = parsed;
      } catch {
        // Invalid allocator state is rebuilt from persisted service ports.
      }
    }

    const result = await assignPersistentPorts({
      services,
      existingServices,
      assignedPorts: rows,
      state,
    });
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(PORT_ALLOCATOR_SETTINGS_KEY, JSON.stringify(result.state));
    return result.services;
  }
}

const allocatorByDatabase = new WeakMap<object, PersistentPortAllocator>();

export function getPersistentPortAllocator(db: DatabaseInstance): PersistentPortAllocator {
  const key = db as unknown as object;
  let allocator = allocatorByDatabase.get(key);
  if (!allocator) {
    allocator = new PersistentPortAllocator(db);
    allocatorByDatabase.set(key, allocator);
  }
  return allocator;
}
