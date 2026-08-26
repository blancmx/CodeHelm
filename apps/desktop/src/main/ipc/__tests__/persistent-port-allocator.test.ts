import { describe, expect, it } from 'vitest';
import type { ServiceConfig } from '@codehelm/domain';
import { assignPersistentPorts } from '../persistent-port-allocator.js';

function service(name: string, type: ServiceConfig['type'], port: number): ServiceConfig {
  return {
    id: name,
    runProfileId: 'profile',
    name,
    type,
    moduleRelativePath: name,
    executable: 'npm',
    args: ['run', 'dev', '--', '--port', '{{PORT}}'],
    cwdRelative: name,
    env: [],
    port,
    healthCheck: { type: 'tcp', port },
    dependsOn: [],
    enabled: true,
    source: 'detected',
  };
}

describe('persistent project port assignment', () => {
  it('continues after the highest persisted port in the same service family', async () => {
    const result = await assignPersistentPorts({
      services: [service('new-web', 'frontend', 5173)],
      assignedPorts: [
        { projectId: 'one', type: 'frontend', port: 5174 },
        { projectId: 'two', type: 'frontend', port: 5175 },
      ],
      isAvailable: async () => true,
    });

    expect(result.services[0].port).toBe(5176);
    expect(result.services[0].healthCheck?.port).toBe(5176);
    expect(result.state.cursors['frontend:5000']).toBe(5177);
  });

  it('keeps the previous assignment when the same project is analyzed again', async () => {
    const detected = service('web', 'frontend', 5173);
    const existing = { ...detected, port: 5182, healthCheck: { type: 'tcp' as const, port: 5182 } };
    const result = await assignPersistentPorts({
      services: [detected],
      existingServices: [existing],
      assignedPorts: [{ projectId: 'same', type: 'frontend', port: 5182 }],
      state: { cursors: { 'frontend:5000': 5190 } },
      isAvailable: async () => true,
    });

    expect(result.services[0].port).toBe(5182);
  });

  it('skips both persisted and currently occupied ports', async () => {
    const unavailable = new Set([8001, 8002]);
    const result = await assignPersistentPorts({
      services: [service('api', 'backend', 8000)],
      assignedPorts: [{ projectId: 'one', type: 'backend', port: 8000 }],
      isAvailable: async (port) => !unavailable.has(port),
    });

    expect(result.services[0].port).toBe(8003);
  });

  it('uses the persisted cursor even after older projects are removed', async () => {
    const result = await assignPersistentPorts({
      services: [service('web', 'frontend', 5173)],
      assignedPorts: [],
      state: { cursors: { 'frontend:5000': 5200 } },
      isAvailable: async () => true,
    });

    expect(result.services[0].port).toBe(5200);
  });

  it('preserves a project-constrained fixed port instead of applying the high watermark', async () => {
    const fixed = { ...service('web', 'frontend', 5173), portMode: 'fixed' as const };
    const result = await assignPersistentPorts({
      services: [fixed],
      assignedPorts: [{ projectId: 'other', type: 'frontend', port: 5178 }],
      isAvailable: async () => true,
    });

    expect(result.services[0].port).toBe(5173);
    expect(result.services[0].portMode).toBe('fixed');
  });
});
