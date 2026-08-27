import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Orchestrator } from '@codehelm/runner';
import { AppSettingsDtoSchema } from '@codehelm/contracts';
import type { LogBatch, RunProfile } from '@codehelm/domain';
import { LogStorage } from '../log-storage.js';
import { resolveLogDirectory } from '../log-directory.js';

describe('persistent service log pipeline', () => {
  let root: string;
  let logs: LogStorage;
  let runner: Orchestrator;
  const settings = () => AppSettingsDtoSchema.parse({});
  const batch = (message: string): LogBatch => ({
    projectId: 'project', runSessionId: 'run', entries: [{
      id: 'entry', serviceSessionId: 'service', serviceName: 'Web',
      timestamp: new Date().toISOString(), stream: 'stdout', message,
    }],
  });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-persistence-'));
    logs = new LogStorage(path.join(root, 'appdata', 'logs'), settings);
    runner = new Orchestrator();
  });
  afterEach(async () => {
    await runner.stopAll();
    await logs.close();
    vi.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-persistence-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores development logs under the CodeHelm repository instead of Electron or cwd', () => {
    expect(resolveLogDirectory({
      isPackaged: false,
      appPath: path.join(root, 'CodeHelm', 'apps', 'desktop'),
      executablePath: path.join(root, 'node_modules', 'electron', 'electron.exe'),
    })).toBe(path.join(root, 'CodeHelm', 'logs'));
  });

  it('stores packaged logs beside CodeHelm.exe, outside the asar archive', () => {
    expect(resolveLogDirectory({
      isPackaged: true,
      appPath: path.join(root, 'CodeHelm', 'resources', 'app.asar'),
      executablePath: path.join(root, 'CodeHelm', 'CodeHelm.exe'),
    })).toBe(path.join(root, 'CodeHelm', 'logs'));
  });

  it('persists actual subprocess output, redacts split secrets, flushes on stop, and reads history on reopen', async () => {
    await logs.close();
    logs = new LogStorage(resolveLogDirectory({
      isPackaged: false,
      appPath: path.join(root, 'CodeHelm', 'apps', 'desktop'),
      executablePath: process.execPath,
    }), settings);
    const projectRoot = path.join(root, 'source');
    await fs.mkdir(projectRoot);
    const profile: RunProfile = {
      id: 'profile', projectId: 'project', name: 'test', isDefault: true, failurePolicy: 'continue',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      services: [{
        id: 'service', runProfileId: 'profile', name: 'Web', type: 'tool', moduleRelativePath: '.',
        executable: process.execPath, cwdRelative: '.', dependsOn: [], enabled: true, source: 'manual',
        env: [{ key: 'SECRET_VALUE', value: 'fixture-secret-42', isSecret: true }],
        args: ['-e', 'process.stdout.write("hello "+process.env.SECRET_VALUE.slice(0,8)); setTimeout(()=>{process.stdout.write(process.env.SECRET_VALUE.slice(8)+" done\\n"); process.stderr.write("error "+process.env.SECRET_VALUE+"\\n");},30);'],
      }],
    };
    runner.onLogs((value) => logs.accept(value));
    await runner.startSession(projectRoot, profile);
    await runner.stopAll();
    await logs.close();
    logs = new LogStorage(logs.directory, settings);
    const status = await logs.getStatus();
    expect(status).toMatchObject({ fileCount: 1, droppedEntries: 0, lastError: null });
    const directory = path.join(logs.directory, 'project');
    const content = await fs.readFile(path.join(directory, (await fs.readdir(directory))[0]), 'utf8');
    const entries = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(entries.every((entry) => typeof entry.runSessionId === 'string' && entry.runSessionId.length > 0)).toBe(true);
    expect(entries.filter((entry) => entry.stream === 'stdout').map((entry) => entry.message).join('')).toContain('hello [REDACTED] done');
    expect(entries.filter((entry) => entry.stream === 'stderr').map((entry) => entry.message).join('')).toContain('error [REDACTED]');
    expect(content).not.toContain('fixture-secret-42');
    expect(await fs.readdir(projectRoot)).toEqual([]);
  }, 15000);

  it('reports write failures and recovers without poisoning the queue', async () => {
    const append = vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(Object.assign(new Error('read only'), { code: 'EACCES' }));
    logs.accept(batch('first'));
    const failed = await logs.getStatus();
    expect(failed.lastError).toContain('read only');
    expect(failed.droppedEntries).toBe(1);
    append.mockRestore();
    logs.accept(batch('next'));
    expect((await logs.getStatus()).fileCount).toBe(1);
    expect((await logs.clear()).deletedCount).toBe(1);
  });

  it('bounds the pending queue and makes overflow visible', async () => {
    logs.accept(batch('x'.repeat(4 * 1024 * 1024 + 1)));
    const status = await logs.getStatus();
    expect(status).toMatchObject({ pendingBytes: 0, fileCount: 0, droppedEntries: 1 });
    expect(status.lastError).toContain('队列已满');
  });
});
