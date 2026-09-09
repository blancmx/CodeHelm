import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ServiceConfig } from '@codehelm/domain';
import { withExecutionReadBudget } from '../execution-input-reader.js';
import { diagnoseServiceInputs } from '../service-input-diagnostics.js';

let root: string;
const service = (patch: Partial<ServiceConfig> = {}): ServiceConfig => ({ id: 's', runProfileId: 'p', name: 'fixture', type: 'tool', moduleRelativePath: '.', cwdRelative: '.', executable: 'node', args: [], env: [], dependsOn: [], enabled: true, source: 'manual', ...patch });
const check = (patch: Partial<ServiceConfig> = {}) => withExecutionReadBudget(async budget => {
  // Match diagnoseProfile: Windows TEMP may contain an 8.3 alias or a junction.
  const physicalRoot = await budget.physical(root);
  return diagnoseServiceInputs(physicalRoot, physicalRoot, service(patch), budget);
});
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-inputs-')); });
afterEach(async () => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('codehelm-inputs-')) throw new Error('Unsafe cleanup');
  await fs.rm(root, { recursive: true, force: true });
});
describe('service input diagnostics', () => {
  it('blocks required empty variables without revealing keys or values', async () => {
    const result = await check({ env: [{ key: 'PRIVATE_KEY_NAME', value: ' ', isSecret: true, required: true }, { key: 'TOKEN', value: 'SECRET_VALUE', required: true }] });
    expect(result).toContainEqual(expect.objectContaining({ code: 'REQUIRED_ENV', status: 'blocked', serviceId: 's' }));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY_NAME|SECRET_VALUE/);
    expect(await check({ env: [{ key: 'OPTIONAL', value: '' }] })).toContainEqual(expect.objectContaining({ code: 'REQUIRED_ENV', status: 'passed' }));
  });
  it('checks definite file references but does not load modules or external configs', async () => {
    await fs.writeFile(path.join(root, 'app.js'), "throw new Error('SIDE_EFFECT')");
    const result = await check({ args: ['app.js', '--env-file', '.env', '-r', 'ts-node/register', '--config=../outside.json'] });
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REFERENCE_FILE', status: 'passed' }),
      expect.objectContaining({ code: 'REFERENCE_FILE', status: 'blocked' }),
      expect.objectContaining({ code: 'REFERENCE_MODULE', status: 'unknown' }),
      expect.objectContaining({ code: 'REFERENCE_OUTSIDE', status: 'unknown' }),
    ]));
    const moduleReference = await check({ args: ['--require=ts-node/register'] });
    expect(moduleReference).toContainEqual(expect.objectContaining({ code: 'REFERENCE_MODULE', status: 'unknown' }));
    expect(moduleReference.some(item => item.status === 'blocked')).toBe(false);
    expect(await check({ args: ['--config'] })).toContainEqual(expect.objectContaining({ code: 'REFERENCE_ARGUMENT', status: 'blocked' }));
  });
  it('detects package manager mismatches and conflicting lockfile families', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.0.0' }));
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), '');
    expect(await check({ executable: 'npm.cmd' })).toContainEqual(expect.objectContaining({ code: 'PACKAGE_MANAGER', status: 'blocked' }));
    expect(await check({ executable: 'pnpm.cmd' })).toContainEqual(expect.objectContaining({ code: 'COMMAND_LOCKFILES', status: 'passed' }));
    await fs.writeFile(path.join(root, 'yarn.lock'), '');
    expect(await check({ executable: 'pnpm.cmd' })).toContainEqual(expect.objectContaining({ code: 'COMMAND_LOCKFILES', status: 'warning' }));
    await fs.writeFile(path.join(root, 'package.json'), '{SECRET_BROKEN');
    const result = await check({ executable: 'pnpm' });
    expect(result).toContainEqual(expect.objectContaining({ code: 'PACKAGE_DECLARATION_UNKNOWN', status: 'unknown' }));
    expect(JSON.stringify(result)).not.toContain('SECRET_BROKEN');
  });
  it('detects an incomplete virtual environment without treating an interpreter file as complete dependencies', async () => {
    const folder = path.join(root, '.venv');
    await fs.mkdir(folder);
    expect(await check()).toContainEqual(expect.objectContaining({ code: 'VENV_INTERPRETER', status: 'warning' }));
    const bin = path.join(folder, process.platform === 'win32' ? 'Scripts' : 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), 'fixture');
    expect(await check()).toContainEqual(expect.objectContaining({ code: 'VENV_INTERPRETER', status: 'unknown' }));
  });
});
