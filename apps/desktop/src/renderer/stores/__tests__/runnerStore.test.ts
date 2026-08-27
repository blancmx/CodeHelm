import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_LOG_BUFFER_BYTES, DEFAULT_MAX_LOG_ENTRY_BYTES, utf8ByteLength } from '@codehelm/domain';
import type { RunSessionDto, ServiceStatusEventDto } from '@codehelm/contracts';
import {
  appendBoundedLogs,
  mergeRunSessionStatuses,
  mergeServiceStatus,
  type RunnerServiceStatus,
} from '../runnerStore.js';

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

  it('hydrates service state when start returns an already-running session', () => {
    const session: RunSessionDto = {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      runProfileId: '00000000-0000-4000-8000-000000000003',
      status: 'RUNNING',
      startedAt: '2026-01-01T00:00:00.000Z',
      services: [{
        id: 'session-service',
        runSessionId: '00000000-0000-4000-8000-000000000001',
        serviceConfigId: 'service-config',
        serviceName: 'Web',
        serviceType: 'frontend',
        status: 'RUNNING',
        pid: 1234,
        port: 5173,
      }],
    };

    expect(mergeRunSessionStatuses(new Map(), session).get('service-config')).toMatchObject({
      status: 'RUNNING',
      port: 5173,
      sessionServiceId: 'session-service',
    });
  });
});

describe('runner log buffer bounds', () => {
  it('limits individual messages and aggregate renderer log bytes', () => {
    const entry = {
      id: 'log-1',
      serviceSessionId: 'session-service',
      serviceName: 'Web',
      stream: 'stdout' as const,
      message: '界'.repeat(DEFAULT_MAX_LOG_ENTRY_BYTES),
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    const result = appendBoundedLogs([], Array.from({ length: 100 }, (_, index) => ({
      ...entry,
      id: `log-${index}`,
    })));

    expect(result.every((item) => utf8ByteLength(item.message) <= DEFAULT_MAX_LOG_ENTRY_BYTES)).toBe(true);
    expect(result.reduce((total, item) => total + utf8ByteLength(item.message), 0))
      .toBeLessThanOrEqual(DEFAULT_MAX_LOG_BUFFER_BYTES);
  });
});
