import { describe, it, expect } from 'vitest';
import { detectCycle, topologicalSortServices, CycleDetectedError } from '../orchestration/topology.js';
import type { ServiceConfig } from '@codehelm/domain';

function createMockService(id: string, name: string, dependsOn: string[] = []): ServiceConfig {
  return {
    id,
    runProfileId: 'mock-profile',
    name,
    type: 'backend',
    moduleRelativePath: '.',
    executable: 'node',
    args: ['index.js'],
    cwdRelative: '.',
    env: [],
    dependsOn,
    enabled: true,
    source: 'detected',
  };
}

describe('DAG Topology and Cycle Detection', () => {
  it('should detect no cycles in independent services', () => {
    const services = [
      createMockService('s1', 'Frontend'),
      createMockService('s2', 'Backend'),
    ];

    expect(detectCycle(services)).toBeNull();

    const layers = topologicalSortServices(services);
    expect(layers.length).toBe(1);
    expect(layers[0].length).toBe(2);
  });

  it('should order linear dependencies correctly', () => {
    // DB -> Backend -> Frontend
    const sDb = createMockService('s1', 'Database');
    const sBackend = createMockService('s2', 'Backend', ['s1']);
    const sFrontend = createMockService('s3', 'Frontend', ['s2']);

    const services = [sFrontend, sDb, sBackend];
    expect(detectCycle(services)).toBeNull();

    const layers = topologicalSortServices(services);
    expect(layers.length).toBe(3);
    expect(layers[0][0].name).toBe('Database');
    expect(layers[1][0].name).toBe('Backend');
    expect(layers[2][0].name).toBe('Frontend');
  });

  it('should support branching parallel execution', () => {
    // DB -> [AuthService, ApiService] -> WebClient
    const sDb = createMockService('db', 'Database');
    const sAuth = createMockService('auth', 'AuthService', ['db']);
    const sApi = createMockService('api', 'ApiService', ['db']);
    const sWeb = createMockService('web', 'WebClient', ['auth', 'api']);

    const services = [sWeb, sAuth, sApi, sDb];
    expect(detectCycle(services)).toBeNull();

    const layers = topologicalSortServices(services);
    expect(layers.length).toBe(3);
    expect(layers[0].map((s) => s.name)).toEqual(['Database']);
    expect(layers[1].map((s) => s.name).sort()).toEqual(['ApiService', 'AuthService']);
    expect(layers[2].map((s) => s.name)).toEqual(['WebClient']);
  });

  it('should detect direct 2-node cycle', () => {
    // A -> B -> A
    const sA = createMockService('a', 'ServiceA', ['b']);
    const sB = createMockService('b', 'ServiceB', ['a']);

    const cycle = detectCycle([sA, sB]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('ServiceA');
    expect(cycle).toContain('ServiceB');

    expect(() => {
      topologicalSortServices([sA, sB]);
    }).toThrow(CycleDetectedError);
  });

  it('should detect 3-node cycle', () => {
    // A -> B -> C -> A
    const sA = createMockService('a', 'ServiceA', ['b']);
    const sB = createMockService('b', 'ServiceB', ['c']);
    const sC = createMockService('c', 'ServiceC', ['a']);

    const cycle = detectCycle([sA, sB, sC]);
    expect(cycle).not.toBeNull();

    expect(() => {
      topologicalSortServices([sA, sB, sC]);
    }).toThrow(CycleDetectedError);
  });
});
