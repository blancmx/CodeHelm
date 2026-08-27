import { afterEach, describe, expect, it } from 'vitest';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { Orchestrator } from '../orchestration/orchestrator.js';

function createProfile(service: ServiceConfig): RunProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    name: 'Test profile',
    isDefault: true,
    failurePolicy: 'continue',
    services: [service],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createService(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    id: 'service-1',
    runProfileId: '11111111-1111-4111-8111-111111111111',
    name: 'Test service',
    type: 'tool',
    moduleRelativePath: '.',
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwdRelative: '.',
    env: [],
    dependsOn: [],
    enabled: true,
    source: 'manual',
    ...overrides,
  };
}

describe('Orchestrator startup result', () => {
  const runners: Orchestrator[] = [];

  afterEach(async () => {
    await Promise.all(runners.map((runner) => runner.stopAll()));
    runners.length = 0;
  });

  it('waits for the initial process check and returns populated services', async () => {
    const runner = new Orchestrator();
    runners.push(runner);

    const session = await runner.startSession(process.cwd(), createProfile(createService()));

    expect(session.status).toBe('RUNNING');
    expect(session.services).toHaveLength(1);
    expect(session.services[0]).toMatchObject({
      serviceConfigId: 'service-1',
      status: 'RUNNING',
    });
    expect(session.services[0].pid).toBeTypeOf('number');
  });

  it('returns FAILED with the real spawn error when no service starts', async () => {
    const runner = new Orchestrator();
    runners.push(runner);
    const service = createService({
      executable: 'codehelm-command-that-does-not-exist',
      args: [],
    });

    const session = await runner.startSession(process.cwd(), createProfile(service));

    expect(session.status).toBe('FAILED');
    expect(session.services).toHaveLength(1);
    expect(session.services[0].status).toBe('FAILED');
    expect(session.services[0].errorMessage).toBeTruthy();
  });
});
