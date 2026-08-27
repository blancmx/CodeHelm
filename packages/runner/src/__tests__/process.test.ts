import { describe, it, expect, afterEach } from 'vitest';
import { ProcessManager } from '../process/process-manager.js';
import { HealthChecker } from '../health/health-checker.js';
import net from 'node:net';
import type { ServiceConfig } from '@codehelm/domain';
import { SecretRedactor } from '../logs/secret-redactor.js';

describe('streaming secret redaction', () => {
  it('redacts secrets at every byte boundary without breaking multibyte output', () => {
    const text = Buffer.from('正常 token=密钥-value-123 done');
    for (let boundary = 0; boundary <= text.length; boundary++) {
      const redactor = new SecretRedactor(['密钥-value-123']);
      const result = redactor.write(text.subarray(0, boundary)) + redactor.write(text.subarray(boundary)) + redactor.end();
      expect(result).toBe('正常 token=[REDACTED] done');
    }
  });

  it('masks an unfinished secret prefix on close and keeps stdout/stderr buffers isolated', () => {
    const stdout = new SecretRedactor(['token-value']);
    const stderr = new SecretRedactor(['token-value']);
    expect(stdout.write(Buffer.from('token-'))).toBe('');
    expect(stderr.write(Buffer.from('value!')) + stderr.end()).toBe('value!');
    expect(stdout.end()).toBe('[REDACTED]');
    expect(stdout.end()).toBe('');
  });
});

describe('ProcessManager & HealthChecker', () => {
  const pm = new ProcessManager();

  afterEach(async () => {
    await pm.stopAll();
  });

  it('should spawn a node process and capture stdout/stderr', async () => {
    const logs: { stream: string; text: string }[] = [];

    const service: ServiceConfig = {
      id: 'test-node-service',
      runProfileId: 'test-profile',
      name: 'Echo Test',
      type: 'backend',
      moduleRelativePath: '.',
      executable: process.execPath,
      args: ['-e', 'console.log("HELLO_STDOUT"); console.error("HELLO_STDERR");'],
      cwdRelative: '.',
      env: [],
      dependsOn: [],
      enabled: true,
      source: 'manual',
    };

    const session = await pm.startService(
      service,
      process.cwd(),
      'test-run-session',
      (_sId, stream, text) => {
        logs.push({ stream, text });
      },
      () => {}
    );

    expect(session.id).toBeDefined();
    expect(session.pid).toBeDefined();

    // Wait 500ms for execution
    await new Promise((r) => setTimeout(r, 600));

    const stdoutLogs = logs.filter((l) => l.stream === 'stdout').map((l) => l.text).join('');
    const stderrLogs = logs.filter((l) => l.stream === 'stderr').map((l) => l.text).join('');

    expect(stdoutLogs).toContain('HELLO_STDOUT');
    expect(stderrLogs).toContain('HELLO_STDERR');
  });

  it('should reliably stop a long-running process', async () => {
    const service: ServiceConfig = {
      id: 'test-sleep-service',
      runProfileId: 'test-profile',
      name: 'Sleep Test',
      type: 'backend',
      moduleRelativePath: '.',
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      cwdRelative: '.',
      env: [],
      dependsOn: [],
      enabled: true,
      source: 'manual',
    };

    const session = await pm.startService(
      service,
      process.cwd(),
      'test-run-session',
      () => {},
      () => {}
    );

    expect(session.pid).toBeDefined();
    expect(pm.getActiveCount()).toBe(1);

    await pm.stopService(session.id);
    expect(pm.getActiveCount()).toBe(0);
  });

  it('should detect port in use and wait for port open', async () => {
    const testPort = 39281;

    // Check available initially
    const initiallyInUse = await HealthChecker.checkPortInUse(testPort);
    expect(initiallyInUse).toBe(false);

    // Create a local TCP server
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(testPort, '127.0.0.1', () => resolve());
    });

    // Check in use
    const nowInUse = await HealthChecker.checkPortInUse(testPort);
    expect(nowInUse).toBe(true);

    // Wait for open probe
    const isOpen = await HealthChecker.waitForPortOpen(testPort, 2000);
    expect(isOpen).toBe(true);

    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
});
