import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import { RUNTIME_SCAN_LIMITS } from '../runtime-profile-constraints.js';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { applyRuntimeProfileConstraints } from '../runtime-profile-constraints.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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
  it('rejects an oversized launcher instead of reading it before confirmation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-launcher-budget-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'start.bat'), Buffer.alloc(512 * 1024 + 1, 32));
    await expect(Promise.resolve(applyRuntimeProfileConstraints(root, profile([
      service('desktop', 'tool', '.', 5000),
    ])))).rejects.toThrow('单文件');
  });
  it('replaces a single inferred service with the project explicit desktop launcher', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-launcher-'));
    tempDirs.push(root);
    const executable = path.join(root, 'dist', 'MineBill', 'MineBill.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '');
    fs.writeFileSync(path.join(root, '启动记账.bat'), `start "" "${executable}"`);

    const detected = service('flask', 'backend', '.', 5000);
    detected.env = [{ key: 'API_TOKEN', value: 'protected-value', isSecret: true }];
    const result = await applyRuntimeProfileConstraints(root, profile([detected]));

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

  it('keeps the frontend on a single hard-coded backend CORS origin port', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-cors-'));
    tempDirs.push(root);
    const sourceDir = path.join(root, 'backend', 'src', 'main', 'java');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'SecurityConfig.java'),
      'config.setAllowedOrigins(List.of("http://localhost:5173"));'
    );

    let hostTurnRan = false;
    setImmediate(() => { hostTurnRan = true; });
    const result = await applyRuntimeProfileConstraints(root, profile([
      service('backend', 'backend', 'backend', 8080),
      service('frontend', 'frontend', 'frontend', 5177),
    ]));

    expect(hostTurnRan).toBe(true);
    const frontend = result.profile.services.find((entry) => entry.id === 'frontend');
    expect(frontend?.port).toBe(5173);
    expect(frontend?.portMode).toBe('fixed');
    expect(frontend?.healthCheck?.port).toBe(5173);
    expect(result.messages[0]).toContain('CORS');
  });

  it('does not mistake an ordinary localhost API URL for a CORS constraint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-api-url-'));
    tempDirs.push(root);
    const sourceDir = path.join(root, 'backend', 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'client.ts'), 'const api = "http://localhost:5173/api";');

    const input = profile([
      service('backend', 'backend', 'backend', 8080),
      service('frontend', 'frontend', 'frontend', 5177),
    ]);
    expect((await applyRuntimeProfileConstraints(root, input)).profile).toBe(input);
  });

  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-runtime-budget-'));
    tempDirs.push(root);
    return root;
  }

  function corsProfile() {
    return profile([service('api', 'backend', 'backend', 8080), service('web', 'frontend', 'web', 5177)]);
  }

  it('rejects synthetic oversized metadata before opening a launcher', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'start.bat'), 'synthetic');
    vi.spyOn(fsp, 'stat').mockResolvedValue({ size: RUNTIME_SCAN_LIMITS.fileBytes + 1, isDirectory: () => false, isFile: () => true } as never);
    const open = vi.spyOn(fsp, 'open');
    await expect(applyRuntimeProfileConstraints(root, profile([service('desktop', 'tool', '.', 0)]))).rejects.toThrow('单文件');
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves shortest launcher priority and %~dp0 paths without altering secret metadata', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'chosen.exe'), '');
    fs.writeFileSync(path.join(root, 'other.exe'), '');
    fs.writeFileSync(path.join(root, 'run.bat'), 'start "" "%~dp0chosen.exe"');
    fs.writeFileSync(path.join(root, 'long-start.bat'), 'start "" "other.exe"');
    const input = profile([service('desktop', 'tool', '.', 0)]);
    input.services[0].env = [{ key: 'SYNTHETIC_SECRET', value: 'synthetic', isSecret: true }];
    const result = await applyRuntimeProfileConstraints(root, input);
    expect(result.profile.services[0]).toMatchObject({ executable: 'chosen.exe', args: [], env: input.services[0].env });
    expect(input.services[0].executable).toBe('mvn');
  });

  it('does not scan irrelevant launchers for manual or multiple-service profiles', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'start.bat'), Buffer.alloc(RUNTIME_SCAN_LIMITS.fileBytes + 1));
    const input = profile([service('desktop', 'tool', '.', 0)]);
    input.services[0].source = 'manual';
    expect((await applyRuntimeProfileConstraints(root, input)).messages).toEqual([]);
    input.services.push(service('second', 'tool', '.', 0));
    expect((await applyRuntimeProfileConstraints(root, input)).messages).toEqual([]);
  });

  it('counts irrelevant entries before selecting a launcher and rejects partial scans', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'start.bat'), 'start "" "app.exe"');
    fs.writeFileSync(path.join(root, 'app.exe'), '');
    fs.writeFileSync(path.join(root, 'irrelevant.txt'), '');
    await expect(applyRuntimeProfileConstraints(root, profile([service('desktop', 'tool', '.', 0)]), { maxEntries: 2 })).rejects.toThrow('目录条目');
  });

  it('bounds deep directory-only traversal without relying on source file count', async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'backend', 'a', 'b', 'c', 'd'), { recursive: true });
    await expect(applyRuntimeProfileConstraints(root, corsProfile(), { maxEntries: 3 })).rejects.toThrow('目录条目');
  });

  it('shares file count and byte budgets across backend roots', async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'backend'));
    fs.mkdirSync(path.join(root, 'second'));
    for (const directory of ['backend', 'second']) fs.writeFileSync(path.join(root, directory, 'cors.ts'), '/* cors http://localhost:5173 */');
    const input = corsProfile();
    input.services.push(service('second', 'backend', 'second', 8081));
    await expect(applyRuntimeProfileConstraints(root, input, { maxFiles: 1 })).rejects.toThrow('文件数量');
    await expect(applyRuntimeProfileConstraints(root, input, { limits: { totalBytes: 40 } })).rejects.toThrow('累计');
  });

  it('deduplicates overlapping backend trees and leaves ambiguous origins unchanged', async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'backend', 'nested'), { recursive: true });
    const file = path.join(root, 'backend', 'nested', 'cors.ts');
    fs.writeFileSync(file, '/* cors http://localhost:5173 http://127.0.0.1:5173 */');
    const input = corsProfile();
    input.services.push(service('nested', 'backend', 'backend/nested', 8081));
    const unique = await applyRuntimeProfileConstraints(root, input, { maxFiles: 1 });
    expect(unique.profile.services.find(entry => entry.id === 'web')?.port).toBe(5173);
    fs.writeFileSync(file, '/* cors http://localhost:5173 http://localhost:5174 */');
    expect((await applyRuntimeProfileConstraints(root, input)).messages).toEqual([]);
  });

  it('skips ignored directories and external junctions; supports a junction project root', async () => {
    const root = fixture();
    const outside = fixture();
    fs.mkdirSync(path.join(root, 'backend', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backend', 'node_modules', 'cors.ts'), '/* cors http://localhost:5999 */');
    fs.writeFileSync(path.join(outside, 'cors.ts'), '/* cors http://localhost:5998 */');
    fs.symlinkSync(outside, path.join(root, 'backend', 'outside'), 'junction');
    fs.writeFileSync(path.join(root, 'backend', 'cors.ts'), '/* cors http://localhost:5173 */');
    const alias = path.join(fixture(), 'project');
    fs.symlinkSync(root, alias, 'junction');
    expect((await applyRuntimeProfileConstraints(alias, corsProfile())).profile.services.find(entry => entry.id === 'web')?.port).toBe(5173);
  });

  it.each(['.venv', 'venv', '.VENV'])('skips Python environment %s while scanning backend CORS sources', async environment => {
    const root = fixture();
    const environmentPackages = path.join(root, 'backend', environment, 'Lib', 'site-packages');
    fs.mkdirSync(environmentPackages, { recursive: true });
    fs.writeFileSync(path.join(environmentPackages, 'cors.py'), 'cors allowedOrigin http://localhost:5999'.repeat(8));
    fs.writeFileSync(path.join(root, 'backend', 'app.py'), 'cors allowedOrigin http://localhost:5173');

    const result = await applyRuntimeProfileConstraints(root, corsProfile(), { limits: { totalBytes: 128 } });
    expect(result.profile.services.find(entry => entry.id === 'web')?.port).toBe(5173);
  });

  it.each(['EACCES', 'EIO'])('rejects %s instead of silently applying partial constraints', async code => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'start.bat'), '');
    vi.spyOn(fsp, 'open').mockRejectedValue(Object.assign(new Error(code), { code }));
    await expect(applyRuntimeProfileConstraints(root, profile([service('desktop', 'tool', '.', 0)]))).rejects.toThrow(code);
  });

  it.each(['cancel', 'timeout'])('returns on %s and closes a directory when pending enumeration settles', async kind => {
    const root = fixture();
    const actualOpen = fsp.opendir.bind(fsp);
    const directory = await actualOpen(root);
    const close = vi.spyOn(directory, 'close');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(fsp, 'opendir').mockImplementationOnce(async () => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      return directory;
    });
    const controller = new AbortController();
    const result = applyRuntimeProfileConstraints(root, profile([service('desktop', 'tool', '.', 0)]), {
      signal: controller.signal, limits: { timeoutMs: kind === 'timeout' ? 40 : 1000 },
    });
    const rejected = expect(result).rejects.toThrow(kind === 'timeout' ? '超时' : '取消');
    await started;
    if (kind === 'cancel') controller.abort();
    await rejected;
    release();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
