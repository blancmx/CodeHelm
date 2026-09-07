import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRuntime, parseRuntimeVersion, probeConfirmedRuntime, probeEnvironment, runtimeArguments } from '../runtime-probe.js';

describe('single-use runtime probe', () => {
  it.each([
    ['node', 'v24.16.0\n', '24.16.0'], ['python', 'Python 3.13.1\n', '3.13.1'],
    ['java', 'openjdk version "25.0.1" 2025-10-21\nOpenJDK Runtime Environment', '25.0.1'],
    ['java', 'java version "1.8.0_451"', '1.8.0_451'],
    ['node', 'secret v24.0.0', null], ['python', 'Python 3.1.0\nsecret', null],
  ] as const)('parses %s without returning arbitrary output', (family, output, expected) => {
    expect(parseRuntimeVersion(family, output)).toBe(expected);
  });
  it('uses fixed arguments and excludes inherited injection variables', () => {
    vi.stubEnv('NODE_OPTIONS', '--require secret.cjs');
    vi.stubEnv('JAVA_TOOL_OPTIONS', '-javaagent:secret.jar');
    vi.stubEnv('PYTHONPATH', 'secret');
    try {
      expect(probeEnvironment()).toEqual(expect.objectContaining({ PATH: '' }));
      expect(probeEnvironment()).not.toHaveProperty('NODE_OPTIONS');
      expect(probeEnvironment()).not.toHaveProperty('JAVA_TOOL_OPTIONS');
      expect(probeEnvironment()).not.toHaveProperty('PYTHONPATH');
      expect(runtimeArguments.python).toEqual(['-I', '-S', '--version']);
    } finally { vi.unstubAllEnvs(); }
  });
  it('rejects project files, cancellation and replacement before execution', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-probe-test-'));
    const project = path.join(root, 'project');
    const file = path.join(root, 'node.exe');
    await fs.mkdir(project);
    await fs.writeFile(file, 'not an executable');
    try {
      await expect(inspectRuntime(file, 'node', root, AbortSignal.timeout(1000))).rejects.toThrow('Project executable');
      await expect(inspectRuntime(file, 'python', project, AbortSignal.timeout(1000))).rejects.toThrow('Unsupported executable');
      await expect(probeConfirmedRuntime(file, 'node', project, AbortSignal.timeout(1000), async () => false)).resolves.toBeNull();
      await expect(probeConfirmedRuntime(file, 'node', project, AbortSignal.timeout(1000), async () => {
        await fs.writeFile(file, 'replacement');
        return true;
      })).rejects.toThrow('Changed executable');
    } finally {
      await fs.unlink(file);
      await fs.rmdir(project);
      await fs.rmdir(root);
    }
  });
});
