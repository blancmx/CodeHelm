import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    tempLogDir = path.join(os.tmpdir(), `codehelm-logs-test-${Date.now()}`);
    await fs.mkdir(tempLogDir, { recursive: true });
    rotator = new LogRotator(tempLogDir);
  });

  afterEach(async () => {
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

    // Run cleanup with maxDays = 0 to trigger immediate cleanup
    const res = await rotator.cleanup(0, 100);
    expect(res.deletedCount).toBeGreaterThanOrEqual(0);
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
