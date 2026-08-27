import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LogEntry } from '@codehelm/domain';
import { LogRotator } from '../logs/log-rotator.js';
import { ProcessVerifier } from '../process/process-verifier.js';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('LogRotator & ProcessVerifier', () => {
  let tempLogDir: string;
  let rotator: LogRotator;

  beforeEach(async () => {
    tempLogDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-logs-test-'));
    rotator = new LogRotator(tempLogDir);
  });

  afterEach(async () => {
    if (path.dirname(tempLogDir) !== path.resolve(os.tmpdir()) || !path.basename(tempLogDir).startsWith('codehelm-logs-test-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(tempLogDir, { recursive: true, force: true });
  });

  it('should append logs to file and calculate total size', async () => {
    await rotator.append('proj-1', 'web', {
      id: 'l1',
      serviceSessionId: 'ss1',
      serviceName: 'web',
      stream: 'stdout',
      message: 'Server started on port 3000',
      timestamp: new Date().toISOString(),
    });

    const size = await rotator.getTotalLogSizeBytes();
    expect(size).toBeGreaterThan(0);
  });

  it('should clean up old logs correctly', async () => {
    await rotator.append('proj-1', 'web', {
      id: 'l1',
      serviceSessionId: 'ss1',
      serviceName: 'web',
      stream: 'stdout',
      message: 'test line',
      timestamp: new Date().toISOString(),
    });

    const projectDir = path.join(tempLogDir, 'proj-1');
    const file = path.join(projectDir, (await fs.readdir(projectDir))[0]);
    const oldDate = new Date(Date.now() - 20 * 86400000);
    await fs.utimes(file, oldDate, oldDate);
    const size = (await fs.stat(file)).size;
    expect(await rotator.cleanup(14, 100)).toEqual({ deletedCount: 1, freedBytes: size });
  });

  const entry = (message: string): LogEntry => ({
    id: message, serviceSessionId: 'session', serviceName: 'web', stream: 'stdout',
    message, timestamp: '2026-08-27T00:00:00.000Z',
  });

  it('serializes concurrent appends, rotates by bytes and retains distinct service names', async () => {
    rotator = new LogRotator(tempLogDir, 600);
    await Promise.all(Array.from({ length: 20 }, (_, i) => rotator.append('project', i % 2 ? 'web/a' : 'web?a', entry(`message-${i}`))));
    const files = await fs.readdir(path.join(tempLogDir, 'project'));
    const messages: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(path.join(tempLogDir, 'project', file), 'utf8');
      expect(Buffer.byteLength(content)).toBeLessThanOrEqual(600);
      messages.push(...content.trim().split('\n').map((line) => JSON.parse(line).message));
    }
    expect(new Set(messages).size).toBe(20);
    expect(files.some((file) => file.endsWith('-1.log'))).toBe(true);
    const before = await rotator.getTotalLogSizeBytes();
    const removed = await rotator.cleanup(90, 600 / 1048576);
    expect(removed.freedBytes).toBe(before - await rotator.getTotalLogSizeBytes());
    expect(await rotator.getTotalLogSizeBytes()).toBeLessThanOrEqual(600);
  });

  it('clears older queued writes without losing writes ordered after the clear', async () => {
    const first = rotator.append('project', 'web', entry('before'));
    const clear = rotator.clearAll();
    const after = rotator.append('project', 'web', entry('after'));
    await Promise.all([first, after]);
    expect((await clear).deletedCount).toBe(1);
    const files = await fs.readdir(path.join(tempLogDir, 'project'));
    const text = await fs.readFile(path.join(tempLogDir, 'project', files[0]), 'utf8');
    expect(text).toContain('after');
    expect(text).not.toContain('before');
  });

  it('rejects traversal and junctions without writing or clearing the target', async () => {
    await expect(rotator.append('../escape', 'web', entry('bad'))).rejects.toThrow();
    const target = path.join(tempLogDir, 'outside');
    await fs.mkdir(target);
    const ownedRoot = path.join(tempLogDir, 'owned');
    await fs.mkdir(ownedRoot);
    await fs.writeFile(path.join(target, 'keep.log'), 'keep');
    await fs.symlink(target, path.join(ownedRoot, 'project'), process.platform === 'win32' ? 'junction' : 'dir');
    const guarded = new LogRotator(ownedRoot);
    await expect(guarded.append('project', 'web', entry('bad'))).rejects.toThrow(/Unsafe/);
    await expect(guarded.clearAll()).rejects.toThrow(/Unsafe/);
    expect(await fs.readFile(path.join(target, 'keep.log'), 'utf8')).toBe('keep');
  });

  it('should verify current process PID as alive', () => {
    const isAlive = ProcessVerifier.isPidAlive(process.pid);
    expect(isAlive).toBe(true);

    const isFakeDead = ProcessVerifier.isPidAlive(99999999);
    expect(isFakeDead).toBe(false);
  });

  it('does not treat a mismatched historical PID fingerprint as owned', () => {
    expect(ProcessVerifier.verifyHistoricalProcess(process.pid, {
      pid: process.pid + 1,
      startTime: Date.now(),
      executable: process.execPath,
      cwd: process.cwd(),
      argsSummary: '',
    })).toBe('ORPHANED');
  });

  it('rejects an exited ChildProcess before PID-based tree termination', () => {
    const child = { pid: process.pid, exitCode: 0, signalCode: null } as unknown as ChildProcess;
    expect(ProcessVerifier.isActiveChildProcess(process.pid, child)).toBe(false);
  });
});
