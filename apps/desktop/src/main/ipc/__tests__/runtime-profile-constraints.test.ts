import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { applyRuntimeProfileConstraints } from '../runtime-profile-constraints.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function service(id: string, type: ServiceConfig['type'], cwdRelative: string, port: number): ServiceConfig {
  return {
    id,
    runProfileId: 'profile',
    name: id,
    type,
    moduleRelativePath: cwdRelative,
    executable: type === 'frontend' ? 'npm' : 'mvn',
    args: ['{{PORT}}'],
    cwdRelative,
    env: [],
    port,
    healthCheck: { type: 'tcp', port },
    dependsOn: [],
    enabled: true,
    source: 'detected',
  };
}

function profile(services: ServiceConfig[]): RunProfile {
  return {
    id: 'profile',
    projectId: 'project',
    name: 'default',
    isDefault: true,
    failurePolicy: 'block_dependents',
    services,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('applyRuntimeProfileConstraints', () => {
  it('replaces a single inferred service with the project explicit desktop launcher', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-launcher-'));
    tempDirs.push(root);
    const executable = path.join(root, 'dist', 'MineBill', 'MineBill.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '');
    fs.writeFileSync(path.join(root, '启动记账.bat'), `start "" "${executable}"`);

    const detected = service('flask', 'backend', '.', 5000);
    detected.env = [{ key: 'API_TOKEN', value: 'protected-value', isSecret: true }];
    const result = applyRuntimeProfileConstraints(root, profile([detected]));

    expect(result.profile.services[0]).toMatchObject({
      name: 'MineBill Desktop',
      type: 'tool',
      executable: 'dist/MineBill/MineBill.exe',
      args: [],
      cwdRelative: '',
    });
    expect(result.profile.services[0].env).toEqual(detected.env);
    expect(result.profile.services[0].port).toBeUndefined();
    expect(result.messages[0]).toContain('显式桌面启动器');
  });

  it('keeps the frontend on a single hard-coded backend CORS origin port', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-cors-'));
    tempDirs.push(root);
    const sourceDir = path.join(root, 'backend', 'src', 'main', 'java');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'SecurityConfig.java'),
      'config.setAllowedOrigins(List.of("http://localhost:5173"));'
    );

    const result = applyRuntimeProfileConstraints(root, profile([
      service('backend', 'backend', 'backend', 8080),
      service('frontend', 'frontend', 'frontend', 5177),
    ]));

    const frontend = result.profile.services.find((entry) => entry.id === 'frontend');
    expect(frontend?.port).toBe(5173);
    expect(frontend?.portMode).toBe('fixed');
    expect(frontend?.healthCheck?.port).toBe(5173);
    expect(result.messages[0]).toContain('CORS');
  });

  it('does not mistake an ordinary localhost API URL for a CORS constraint', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-api-url-'));
    tempDirs.push(root);
    const sourceDir = path.join(root, 'backend', 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'client.ts'), 'const api = "http://localhost:5173/api";');

    const input = profile([
      service('backend', 'backend', 'backend', 8080),
      service('frontend', 'frontend', 'frontend', 5177),
    ]);
    expect(applyRuntimeProfileConstraints(root, input).profile).toBe(input);
  });
});
