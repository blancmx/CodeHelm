import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { Orchestrator } from '../orchestration/orchestrator.js';
import { HealthChecker } from '../health/health-checker.js';
import { ProcessManager } from '../process/process-manager.js';

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
    vi.restoreAllMocks();
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

  it.each(['spawn', 'exit', 'timeout', 'invalid-cwd'] as const)(
    'blocks every downstream layer after %s failure while an independent service still runs',
    async (failure) => {
      const runner = new Orchestrator();
      runners.push(runner);
      const first = createService({ id: 'first' });
      if (failure === 'spawn') first.executable = 'codehelm-command-that-does-not-exist';
      if (failure === 'exit') first.args = ['-e', 'process.exit(7)'];
      if (failure === 'timeout') {
        first.healthCheck = { type: 'tcp', port: 49999 };
        vi.spyOn(HealthChecker, 'waitForPortOpen').mockResolvedValue(false);
      }
      if (failure === 'invalid-cwd') first.cwdRelative = '..';
      const profile = createProfile(first);
      profile.failurePolicy = 'block_dependents';
      profile.services.push(
        createService({ id: 'second', dependsOn: ['first'] }),
        createService({ id: 'third', dependsOn: ['second'] }),
        createService({ id: 'independent' }),
      );

      const session = await runner.startSession(process.cwd(), profile);

      expect(session.services.map(s => s.serviceConfigId)).not.toContain('second');
      expect(session.services.map(s => s.serviceConfigId)).not.toContain('third');
      expect(session.services.find(s => s.serviceConfigId === 'independent')?.status).toBe('RUNNING');
      expect(session.status).toBe('PARTIAL_FAILED');
    }, 20000,
  );

  it.each(['exit', 'timeout'] as const)('rolls back live children after %s and retains the failure', async (failure) => {
    const runner = new Orchestrator();
    runners.push(runner);
    const first = createService({ id: 'first' });
    if (failure === 'exit') first.args = ['-e', 'process.exit(7)'];
    else {
      first.healthCheck = { type: 'tcp', port: 49999 };
      vi.spyOn(HealthChecker, 'waitForPortOpen').mockResolvedValue(false);
    }
    const profile = createProfile(first);
    profile.failurePolicy = 'rollback_all';
    profile.services.push(
      createService({ id: 'independent' }),
      createService({ id: 'downstream', dependsOn: ['first'] }),
    );

    const session = await runner.startSession(process.cwd(), profile);

    expect(session.status).toBe('FAILED');
    expect(session.stoppedAt).toBeTruthy();
    expect(session.services.map(s => s.serviceConfigId)).not.toContain('downstream');
    expect(session.services.find(s => s.serviceConfigId === 'first')?.status).toBe('FAILED');
    expect(session.services.find(s => s.serviceConfigId === 'independent')?.status).toBe('STOPPED');
    for (const service of session.services) {
      if (service.pid) expect(() => process.kill(service.pid!, 0)).toThrow();
    }
    await runner.stopSession(session.id);
    expect(session.status).toBe('FAILED');
  }, 20000);

  it('keeps the continue policy distinct from dependency blocking', async () => {
    const runner = new Orchestrator();
    runners.push(runner);
    const profile = createProfile(createService({ id: 'first', args: ['-e', 'process.exit(7)'] }));
    profile.services.push(createService({ id: 'downstream', dependsOn: ['first'] }));
    const session = await runner.startSession(process.cwd(), profile);
    expect(session.services.find(s => s.serviceConfigId === 'downstream')?.status).toBe('RUNNING');
    expect(session.status).toBe('PARTIAL_FAILED');
  }, 20000);

  it('does not mark a rollback complete when a child could not be stopped', async () => {
    const runner = new Orchestrator();
    runners.push(runner);
    vi.spyOn(HealthChecker, 'waitForPortOpen').mockResolvedValue(false);
    vi.spyOn(ProcessManager.prototype, 'stopService').mockRejectedValueOnce(new Error('Simulated stop failure'));
    const profile = createProfile(createService({ healthCheck: { type: 'tcp', port: 49999 } }));
    profile.failurePolicy = 'rollback_all';

    const session = await runner.startSession(process.cwd(), profile);

    expect(session.status).toBe('PARTIAL_FAILED');
    expect(session.stoppedAt).toBeUndefined();
    expect(runner.getActiveSessions().map(s => s.id)).toContain(session.id);
    expect(session.services[0].status).toBe('DEGRADED');
    expect(() => process.kill(session.services[0].pid!, 0)).not.toThrow();
    await runner.stopSession(session.id);
    expect(() => process.kill(session.services[0].pid!, 0)).toThrow();
  }, 20000);
});
