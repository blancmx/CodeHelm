import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { RuntimeFamily, RuntimeProbeDto } from '@codehelm/contracts';

export const runtimeArguments: Record<RuntimeFamily, string[]> = {
  node: ['--version'], python: ['-I', '-S', '--version'], java: ['-version'],
};

export function parseRuntimeVersion(family: RuntimeFamily, output: string): string | null {
  const patterns = {
    node: /^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*$/,
    python: /^Python (\d+\.\d+\.\d+(?:[abrc\d]+)?)\s*$/,
    java: /^(?:openjdk|java) version "([\d][\w.+_-]{0,64})"(?:\s|$)/,
  };
  return patterns[family].exec(output.trim())?.[1] ?? null;
}

export function probeEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: '' };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const entry = Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (entry) result[key] = entry[1];
  }
  return result;
}

export async function inspectRuntime(file: string, family: RuntimeFamily, projectRoot: string, signal: AbortSignal) {
  const [resolved, root] = await Promise.all([fs.realpath(file), fs.realpath(projectRoot)]);
  const relative = path.relative(root, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Project executable');
  }
  if (path.basename(resolved).toLowerCase() !== `${family}.exe`) throw new Error('Unsupported executable');
  const handle = await fs.open(resolved, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > 256 * 1024 * 1024) throw new Error('Invalid size');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(256 * 1024);
    let total = 0;
    while (total < before.size) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - total), total);
      if (!bytesRead) throw new Error('Changed executable');
      hash.update(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Changed executable');
    return { path: resolved, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

export async function executeRuntimeProbe(file: string, family: RuntimeFamily, signal: AbortSignal): Promise<string | null> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-runtime-probe-'));
  try {
    signal.throwIfAborted();
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(file, runtimeArguments[family], {
        cwd, env: probeEnvironment(), shell: false, windowsHide: true,
        timeout: 3_000, maxBuffer: 4_096, signal, encoding: 'utf8',
      }, (error, stdout, stderr) => error ? reject(error) : resolve(family === 'java' ? stderr || stdout : stdout));
      child.stdin?.end();
    });
    return parseRuntimeVersion(family, output);
  } finally {
    // Remove only the empty directory created here; never recursively remove executable output.
    await fs.rmdir(cwd).catch(() => undefined);
  }
}

export async function probeConfirmedRuntime(
  file: string, family: RuntimeFamily, root: string, signal: AbortSignal,
  confirm: (review: { path: string; sha256: string }) => Promise<boolean>,
): Promise<RuntimeProbeDto | null> {
  const inspect = () => inspectRuntime(file, family, root, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
  const before = await inspect();
  if (!await confirm(before)) return null;
  signal.throwIfAborted();
  const ready = await inspect();
  if (JSON.stringify(before) !== JSON.stringify(ready)) throw new Error('Changed executable');
  const version = await executeRuntimeProbe(ready.path, family, signal);
  if (JSON.stringify(await inspect()) !== JSON.stringify(ready)) throw new Error('Changed executable');
  return { family, executablePath: ready.path, sha256: ready.sha256, version, checkedAt: new Date().toISOString(), services: [] };
}
