import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { ProfileDiagnosticsDtoSchema } from '@codehelm/contracts';
import { diagnoseProfile } from '../profile-diagnostics.js';

let root: string;
const profileId = '11111111-1111-4111-8111-111111111111';
function profile(services: Partial<ServiceConfig>[] = [{}]): RunProfile {
  return {
    id: profileId, projectId: '22222222-2222-4222-8222-222222222222', name: 'fixture',
    isDefault: true, failurePolicy: 'block_dependents', createdAt: '', updatedAt: '',
    services: services.map((service, i) => ({
      id: `service-${i}`, runProfileId: profileId, name: `Service ${i}`, type: 'tool',
      moduleRelativePath: '.', executable: process.execPath, args: [], cwdRelative: '.', env: [],
      dependsOn: [], enabled: true, source: 'manual', ...service,
    })),
  };
}

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-diagnostics-')); });
afterEach(async () => {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('codehelm-diagnostics-')) {
    throw new Error('Unsafe fixture cleanup');
  }
  await fs.rm(resolved, { recursive: true, force: true });
});

describe('metadata-only environment diagnostics', () => {
  it('does not execute local scripts or expose secrets, and leaves input unchanged', async () => {
    const sentinel = path.join(root, 'SIDE_EFFECT');
    const executable = path.join(root, 'local.cmd');
    await fs.writeFile(executable, `@echo off\r\necho executed > "${sentinel}"`);
    const input = profile([{ executable, env: [{ key: 'API_KEY', value: 'secret-never-expose', isSecret: true }] }]);
    const before = JSON.stringify(input);
    const report = await diagnoseProfile(root, input);
    expect(ProfileDiagnosticsDtoSchema.safeParse(report).success).toBe(true);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COMMAND_FOUND', status: 'passed' }),
      expect.objectContaining({ code: 'RUNTIME_VERSION_UNCHECKED', status: 'unknown' }),
    ]));
    expect(JSON.stringify(report)).not.toContain('secret-never-expose');
    expect(JSON.stringify(input)).toBe(before);
    expect(await fs.stat(sentinel).catch(() => null)).toBeNull();
    expect(Date.parse(report.expiresAt) - Date.parse(report.checkedAt)).toBe(60_000);
  });

  it('reports missing roots and escaped or missing working directories', async () => {
    expect((await diagnoseProfile(path.join(root, 'absent'), profile())).checks[0]).toMatchObject({ code: 'ROOT_MISSING', status: 'blocked' });
    const report = await diagnoseProfile(root, profile([{ cwdRelative: '..' }, { cwdRelative: 'absent' }]));
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceId: 'service-0', code: 'CWD_OUTSIDE_PROJECT', status: 'blocked' }),
      expect.objectContaining({ serviceId: 'service-1', code: 'CWD_MISSING', status: 'blocked' }),
    ]));
  });

  it('rejects working directories redirected outside the project', async () => {
    const projectRoot = path.join(root, 'project');
    const outside = path.join(root, 'outside');
    await fs.mkdir(projectRoot);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(projectRoot, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    const report = await diagnoseProfile(projectRoot, profile([{ cwdRelative: 'redirect' }]));
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'CWD_OUTSIDE_PROJECT', status: 'blocked' }));
  });

  it('distinguishes absent commands, empty variables, and dependency hints', async () => {
    await fs.writeFile(path.join(root, 'package-lock.json'), 'not parsed');
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'not parsed');
    await fs.mkdir(path.join(root, 'node_modules'));
    const report = await diagnoseProfile(root, profile([{ executable: 'codehelm-missing-command', env: [{ key: 'OPTIONAL', value: '' }] }]), { environment: { PATH: '' } });
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COMMAND_NOT_FOUND', status: 'blocked' }),
      expect.objectContaining({ code: 'ENVIRONMENT_VALUES', status: 'warning' }),
      expect.objectContaining({ code: 'LOCKFILE_MANAGERS', status: 'warning' }),
      expect.objectContaining({ code: 'DEPENDENCY_HINTS', status: 'unknown' }),
    ]));
  });

  it('uses service PATH overrides without executing the resolved file', async () => {
    const bin = path.join(root, 'bin with spaces');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'fixture-command.cmd' : 'fixture-command'), 'exit 1');
    const report = await diagnoseProfile(root, profile([{ executable: 'fixture-command', env: [{ key: 'PATH', value: bin }] }]), { environment: { Path: 'unrelated' } });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'COMMAND_FOUND' }));
  });

  it('checks enabled-service dependencies and refuses empty plans', async () => {
    const report = await diagnoseProfile(root, profile([
      { dependsOn: ['service-1'] }, { dependsOn: ['service-0'] }, { dependsOn: ['missing'] }, { enabled: false },
    ]));
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'SERVICE_GRAPH', status: 'blocked' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'DEPENDENCY_DISABLED', serviceId: 'service-2' }));
    expect(report.checks.some(check => check.serviceId === 'service-3')).toBe(false);
    expect((await diagnoseProfile(root, profile([]))).checks).toContainEqual(expect.objectContaining({ code: 'NO_ENABLED_SERVICES' }));
  });

  it('reports an occupied real port without stopping its owner or claiming an installation problem', async () => {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as net.AddressInfo).port;
      const report = await diagnoseProfile(root, profile([{ port }]));
      expect(report.checks).toContainEqual(expect.objectContaining({ code: 'PORT_UNAVAILABLE', status: 'blocked' }));
      expect(server.listening).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('handles invalid ports, incomplete checks and cancellation without exposing raw errors', async () => {
    const report = await diagnoseProfile(root, profile([{ port: 70000 }, { port: 32123 }]), {
      portAvailable: async () => { throw new Error('private-path-and-secret'); },
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'PORT_INVALID', status: 'blocked' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'PORT_UNKNOWN', status: 'unknown' }));
    expect(JSON.stringify(report)).not.toContain('private-path-and-secret');
    const controller = new AbortController();
    controller.abort();
    await expect(diagnoseProfile(root, profile(), { signal: controller.signal })).rejects.toThrow();
  });

  it('allows automatic port fallback only for detected non-fixed services', async () => {
    const report = await diagnoseProfile(root, profile([
      { source: 'detected', port: 32123, portMode: 'auto' },
      { source: 'detected', port: 32124, portMode: 'fixed' },
    ]), { portAvailable: async () => false });
    expect(report.checks).toContainEqual(expect.objectContaining({ serviceId: 'service-0', code: 'PORT_UNAVAILABLE', status: 'warning' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ serviceId: 'service-1', code: 'PORT_UNAVAILABLE', status: 'blocked' }));
  });

  it('changes fingerprints when configuration or environment changes', async () => {
    const first = await diagnoseProfile(root, profile(), { environment: { PATH: '' } });
    const second = await diagnoseProfile(root, profile([{ env: [{ key: 'TOKEN', value: 'changed', isSecret: true }] }]), { environment: { PATH: '' } });
    const third = await diagnoseProfile(root, profile(), { environment: { PATH: 'changed' } });
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(third.fingerprint);
  });
});
