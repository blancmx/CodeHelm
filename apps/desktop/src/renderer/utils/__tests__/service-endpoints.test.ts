import { describe, expect, it } from 'vitest';
import type { ProcessStatus } from '@codehelm/contracts';
import { getProfileProcessStatus, getServiceEndpoint, getServiceEndpoints } from '../service-endpoints.js';

const backend = { id: 'api', name: 'Native HTTP Fixture', type: 'backend' };

describe('runtime service addresses', () => {
  it.each(['STARTING', 'STOPPING', 'FAILED', 'DEGRADED', 'VERIFYING', 'ORPHANED'] as ProcessStatus[])(
    'does not summarize mixed running and %s services as RUNNING', status => {
      const statuses = new Map([
        ['web', { status: 'RUNNING' as ProcessStatus }], ['api', { status }],
      ]);
      expect(getProfileProcessStatus([{ id: 'web' }, { id: 'api' }], statuses)).toBe(status);
    },
  );

  it('excludes other profiles from the summary and distinguishes stopped from unstarted', () => {
    const statuses = new Map([['other', { status: 'RUNNING' as const }], ['api', { status: 'STOPPED' as const }]]);
    expect(getProfileProcessStatus([], statuses)).toBe('IDLE');
    expect(getProfileProcessStatus([{ id: 'api' }], statuses)).toBe('STOPPED');
  });

  it('uses the allocated runtime port and a root address, never inferred docs or HTTP 200', () => {
    const config = { ...backend, port: 5173, healthCheck: { type: 'http', expectedStatus: 200 } };
    const endpoint = getServiceEndpoint(config, { status: 'RUNNING', port: 5174 });
    expect(endpoint).toMatchObject({ serviceId: 'api', url: 'http://localhost:5174', port: 5174,
      statusLabel: '运行中', canOpen: true, actionLabel: '打开服务地址' });
    expect(endpoint).not.toHaveProperty('statusCode');
  });

  it.each(['FastAPI backend', 'Swagger api server', 'Spring Boot backend'])(
    'does not infer a documentation route from the service name %s', name => {
      expect(getServiceEndpoint({ ...backend, name }, { status: 'RUNNING', port: 8080 })?.url)
        .toBe('http://localhost:8080');
    },
  );

  it.each(['auxiliary', 'tool', undefined])('does not treat a name or port as proof of a web service: %s', type => {
    expect(getServiceEndpoint({ ...backend, name: 'api server', type }, { status: 'RUNNING', port: 6379 }))
      .toBeUndefined();
  });

  it.each([undefined, 0, -1, 65536, 1.5, NaN, Infinity])('does not link to invalid or absent runtime port %s', port => {
    const configured = { ...backend, port: 8080 };
    expect(getServiceEndpoint(configured, { status: 'RUNNING', port })).toBeUndefined();
  });

  it.each(['IDLE', 'STOPPED', 'FAILED', 'VERIFYING', 'ORPHANED'] as ProcessStatus[])(
    'does not offer stale addresses from state %s', status => {
      expect(getServiceEndpoint(backend, { status, port: 8080 })).toBeUndefined();
    },
  );

  it.each([
    ['STARTING', '启动中'], ['STOPPING', '停止中'], ['DEGRADED', '状态异常'],
  ] as const)('shows %s without exposing an enabled browser shortcut', (status, statusLabel) => {
    expect(getServiceEndpoint(backend, { status, port: 8080 }))
      .toMatchObject({ status, statusLabel, canOpen: false });
  });

  it('combines only live profile services with stable frontend-first ordering', () => {
    const services = [backend, { id: 'web-1', name: 'web', type: 'frontend' },
      { id: 'web-2', name: 'web two', type: 'frontend' }, { id: 'missing', name: 'missing', type: 'backend' }];
    const statuses = new Map([
      ['api', { status: 'STARTING' as const, port: 8080 }],
      ['web-1', { status: 'RUNNING' as const, port: 5174 }],
      ['web-2', { status: 'RUNNING' as const, port: 5175 }],
      ['unrelated', { status: 'RUNNING' as const, port: 9999 }],
    ]);
    const endpoints = getServiceEndpoints(services, statuses);
    expect(endpoints.map(e => e.serviceId)).toEqual(['web-1', 'web-2', 'api']);
    expect(endpoints.filter(e => e.canOpen).map(e => e.url))
      .toEqual(['http://localhost:5174', 'http://localhost:5175']);
    statuses.set('web-1', { status: 'RUNNING', port: 5180 });
    expect(getServiceEndpoints(services, statuses)[0].url).toBe('http://localhost:5180');
  });
});
