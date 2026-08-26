import { describe, expect, it } from 'vitest';
import type { ServiceConfig } from '@codehelm/domain';
import { PortConflictError, prepareServicePort } from '../orchestration/port-allocator.js';

function service(source: ServiceConfig['source']): ServiceConfig {
  return {
    id: 'web',
    runProfileId: 'profile',
    name: 'Web',
    type: 'frontend',
    moduleRelativePath: 'apps/web',
    executable: 'pnpm',
    args: ['run', 'dev', '--', '--port', '{{PORT}}'],
    cwdRelative: 'apps/web',
    env: [],
    port: 5173,
    healthCheck: { type: 'tcp', port: 5173 },
    dependsOn: [],
    enabled: true,
    source,
  };
}

describe('runtime port allocation', () => {
  it('moves an auto-detected service to the next available port and binds it to the process', async () => {
    const reserved = new Set<number>([5174]);
    const result = await prepareServicePort(
      service('detected'),
      reserved,
      async (port) => port !== 5173
    );

    expect(result.changed).toBe(true);
    expect(result.assignedPort).toBe(5175);
    expect(result.service.port).toBe(5175);
    expect(result.service.args).toContain('5175');
    expect(result.service.args).not.toContain('{{PORT}}');
    expect(result.service.env).toContainEqual({ key: 'PORT', value: '5175' });
    expect(result.service.healthCheck?.port).toBe(5175);
  });

  it('keeps an available preferred port', async () => {
    const result = await prepareServicePort(service('detected'), new Set(), async () => true);
    expect(result.changed).toBe(false);
    expect(result.assignedPort).toBe(5173);
    expect(result.service.args).toContain('5173');
  });

  it('does not silently change a manually configured port', async () => {
    await expect(
      prepareServicePort(service('manual'), new Set(), async () => false)
    ).rejects.toBeInstanceOf(PortConflictError);
  });
});
