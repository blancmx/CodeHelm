import { describe, expect, it } from 'vitest';
import type { ServiceStatusEventDto } from '@codehelm/contracts';
import { mergeServiceStatus, type RunnerServiceStatus } from '../runnerStore.js';

function event(status: ServiceStatusEventDto['status']): ServiceStatusEventDto {
  return {
    projectId: 'project',
    runSessionId: 'run',
    serviceSessionId: 'session-service',
    serviceConfigId: 'service-config',
    serviceName: 'Web',
    status,
    pid: 1234,
    port: 5180,
  };
}

describe('runner service status merge', () => {
  it('keeps one entry when an older state contains config and session aliases', () => {
    const duplicated = new Map<string, RunnerServiceStatus>([
      ['service-config', { status: 'STARTING', sessionServiceId: 'session-service' }],
      ['session-service', { status: 'STARTING', sessionServiceId: 'session-service' }],
    ]);

    const result = mergeServiceStatus(duplicated, event('RUNNING'));

    expect([...result.keys()]).toEqual(['service-config']);
    expect(result.get('service-config')).toMatchObject({
      status: 'RUNNING',
      pid: 1234,
      port: 5180,
    });
  });
});
