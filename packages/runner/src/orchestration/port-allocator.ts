import net from 'node:net';
import type { ServiceConfig } from '@codehelm/domain';

export const PORT_TOKEN = '{{PORT}}';

export class PortConflictError extends Error {
  constructor(
    public readonly port: number,
    public readonly serviceName: string,
    public readonly reason: 'manual' | 'project_constraint' = 'manual'
  ) {
    super(
      reason === 'project_constraint'
        ? `Port ${port} is required by project configuration for service "${serviceName}" but is already in use`
        : `Port ${port} is already in use for manually configured service "${serviceName}"`
    );
    this.name = 'PortConflictError';
  }
}

export interface RuntimePortResolution {
  service: ServiceConfig;
  preferredPort?: number;
  assignedPort?: number;
  changed: boolean;
}

async function canBindHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export async function isPortAvailable(port: number): Promise<boolean> {
  // Vite and several other frameworks resolve localhost to IPv6 on Windows.
  // A port is safe only when both localhost loopback families are available.
  const [ipv4Available, ipv6Available] = await Promise.all([
    canBindHost(port, '127.0.0.1'),
    canBindHost(port, '::1'),
  ]);
  return ipv4Available && ipv6Available;
}

export async function prepareServicePort(
  service: ServiceConfig,
  reservedPorts: Set<number>,
  isAvailable: (port: number) => Promise<boolean> = isPortAvailable
): Promise<RuntimePortResolution> {
  if (!service.port) return { service: cloneService(service), changed: false };

  const preferredPort = service.port;
  let assignedPort = preferredPort;
  const preferredAvailable = !reservedPorts.has(preferredPort) && await isAvailable(preferredPort);

  if (!preferredAvailable) {
    if (service.portMode === 'fixed') {
      throw new PortConflictError(preferredPort, service.name, 'project_constraint');
    }
    if (service.source === 'manual') throw new PortConflictError(preferredPort, service.name);

    assignedPort = await findAvailablePort(preferredPort + 1, reservedPorts, isAvailable);
  }

  reservedPorts.add(assignedPort);
  return {
    service: applyPort(service, assignedPort),
    preferredPort,
    assignedPort,
    changed: assignedPort !== preferredPort,
  };
}

async function findAvailablePort(
  startPort: number,
  reservedPorts: Set<number>,
  isAvailable: (port: number) => Promise<boolean>
): Promise<number> {
  const maxPort = Math.min(65535, startPort + 200);
  for (let port = Math.max(1024, startPort); port <= maxPort; port += 1) {
    if (reservedPorts.has(port)) continue;
    if (await isAvailable(port)) return port;
  }
  throw new Error(`No available port found between ${startPort} and ${maxPort}`);
}

function applyPort(service: ServiceConfig, port: number): ServiceConfig {
  const replacement = String(port);
  const args = service.args.map((arg) => arg.split(PORT_TOKEN).join(replacement));
  const env = service.env.map((entry) => ({
    ...entry,
    value: entry.value.split(PORT_TOKEN).join(replacement),
  }));
  const portIndex = env.findIndex((entry) => entry.key.toUpperCase() === 'PORT');
  if (portIndex >= 0 && service.source === 'detected') {
    env[portIndex] = { ...env[portIndex], value: replacement };
  } else if (portIndex < 0) {
    env.push({ key: 'PORT', value: replacement });
  }

  return {
    ...service,
    args,
    env,
    port,
    portMode: service.portMode,
    healthCheck: service.healthCheck
      ? { ...service.healthCheck, port }
      : service.healthCheck,
  };
}

function cloneService(service: ServiceConfig): ServiceConfig {
  return {
    ...service,
    args: [...service.args],
    env: service.env.map((entry) => ({ ...entry })),
    dependsOn: [...service.dependsOn],
    healthCheck: service.healthCheck ? { ...service.healthCheck } : undefined,
  };
}
