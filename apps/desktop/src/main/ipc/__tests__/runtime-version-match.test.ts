import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { RunProfile } from '@codehelm/domain';
import type { RuntimeProbeDto } from '@codehelm/contracts';
import { matchRuntimeToProfile, parseNodeRequirement } from '../runtime-version-match.js';

describe('finite Node requirement grammar', () => {
  it.each([
    ['>=22.12.0 <25', '24.16.0', true], ['>=22.12.0 <25', '25.0.0', false],
    ['^22.1.0 || ^24.0.0', '24.16.0', true], ['^22.1.0 || ^24.0.0', '23.0.0', false],
    ['~22.1.0', '22.2.0', false], ['^0.2.3', '0.3.0', false], ['^0.0.3', '0.0.4', false],
    ['=24.16.0', '24.16.0', true], ['>24.0.0 <=24.16.0', '24.16.0', true],
    ['>=22 <24.17', '24.16.0', true], ['*', '24.0.0-rc.1', null],
  ])('%s compared with %s', (range, actual, expected) => {
    expect(parseNodeRequirement(range as string)?.(actual as string)).toBe(expected);
  });
  it.each(['', '>=22.0.0 || SECRET_VALUE', '^22', '22.x', '<=22', '>22', '>=01.0.0', 'v22.0.0', '22.0.0 - 24.0.0', '>=22.0.0 ||', ' '.repeat(257), null, {}])('rejects unsupported expressions completely: %s', range => {
    expect(parseNodeRequirement(range)).toBeNull();
  });
});

let root: string;
const probe: RuntimeProbeDto = { family: 'node', executablePath: process.execPath, sha256: 'fixture', version: '24.16.0', checkedAt: new Date().toISOString(), services: [] };
function profile(executable = process.execPath, cwdRelative = '.'): RunProfile {
  return { id: 'profile', projectId: 'project', name: 'fixture', isDefault: true, failurePolicy: 'block_dependents', createdAt: '', updatedAt: '',
    services: [{ id: 'service', runProfileId: 'profile', name: 'Node service', type: 'tool', executable, args: [], cwdRelative, moduleRelativePath: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }] };
}
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-version-match-')); });
afterEach(async () => {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-version-match-')) throw new Error('Unsafe fixture');
  await fs.rm(root, { recursive: true, force: true });
});
const writeManifest = (value: unknown) => fs.writeFile(path.join(root, 'package.json'), JSON.stringify(value));
describe('runtime service matching', () => {
  it('compares static Python declarations, rereads changes and preserves unknown states', async () => {
    const python = { ...probe, family: 'python' as const, version: '3.13.0' };
    const manifest = path.join(root, 'pyproject.toml');
    // The probe is synthetic here; actual executable selection is covered by Electron E2E.
    expect((await matchRuntimeToProfile(root, profile(), python))[0].requirementStatus).toBe('unspecified');
    await fs.writeFile(manifest, '[project]\nrequires-python = ">=3.10, <4"');
    expect((await matchRuntimeToProfile(root, profile(), python))[0]).toMatchObject({ commandMatch: 'matched', requirementStatus: 'satisfied', source: 'pyproject.toml → project.requires-python' });
    await fs.writeFile(manifest, '[project]\nrequires-python = ">=3.14"');
    expect((await matchRuntimeToProfile(root, profile(), python))[0].requirementStatus).toBe('unsatisfied');
    for (const content of ['[project', '[project]\ndynamic = ["requires-python"]', '[project]\nrequires-python = "SECRET"', '[project]\nrequires-python = 3', ' '.repeat(65537)]) {
      await fs.writeFile(manifest, content);
      const result = await matchRuntimeToProfile(root, profile(), python);
      expect(result[0].requirementStatus).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
    await fs.writeFile(manifest, '[tool.poetry.dependencies]\npython = "^3.13"');
    expect((await matchRuntimeToProfile(root, profile(), python))[0].requirementStatus).toBe('unspecified');
  });
  it('matches direct paths and compares fresh service declarations without mutating the profile', async () => {
    const input = profile();
    const before = JSON.stringify(input);
    await writeManifest({ engines: { node: '>=22.12.0 <25' } });
    expect(await matchRuntimeToProfile(root, input, probe)).toContainEqual(expect.objectContaining({ commandMatch: 'matched', requirementStatus: 'satisfied', source: 'package.json → engines.node' }));
    await writeManifest({ engines: { node: '>=99.0.0' } });
    expect((await matchRuntimeToProfile(root, input, probe))[0].requirementStatus).toBe('unsatisfied');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('does not attribute a selected runtime to PATH or indirect commands', async () => {
    for (const command of ['node', 'npm', 'pnpm.cmd', 'python']) {
      expect((await matchRuntimeToProfile(root, profile(command), probe))[0]).toMatchObject({ commandMatch: 'unknown', requirementStatus: 'unknown' });
    }
    expect((await matchRuntimeToProfile(root, profile(path.join(root, 'wrapper.cmd')), probe))[0]).toMatchObject({ commandMatch: 'different', requirementStatus: 'unknown' });
  });
  it('separates absent requirements from malformed or unsupported data without leaking payloads', async () => {
    expect((await matchRuntimeToProfile(root, profile(), probe))[0].requirementStatus).toBe('unspecified');
    await writeManifest({ name: 'no-engine' });
    expect((await matchRuntimeToProfile(root, profile(), probe))[0].requirementStatus).toBe('unspecified');
    for (const value of [{ engines: null }, { engines: { node: 'SECRET_VALUE' } }, []]) {
      await writeManifest(value);
      const result = await matchRuntimeToProfile(root, profile(), probe);
      expect(result[0].requirementStatus).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain('SECRET_VALUE');
    }
    await fs.writeFile(path.join(root, 'package.json'), '{broken');
    expect((await matchRuntimeToProfile(root, profile(), probe))[0].requirementStatus).toBe('unknown');
  });
  it('honors service directories and rejects escaped cwd, reparse files and oversized manifests', async () => {
    await writeManifest({ engines: { node: '>=99.0.0' } });
    await fs.mkdir(path.join(root, 'child'));
    expect((await matchRuntimeToProfile(root, profile(process.execPath, 'child'), probe))[0].requirementStatus).toBe('unspecified');
    expect((await matchRuntimeToProfile(root, profile(process.execPath, '..'), probe))[0].commandMatch).toBe('unknown');
    await fs.writeFile(path.join(root, 'child', 'package.json'), JSON.stringify({ engines: { node: '*' } }));
    await fs.symlink(path.join(root, 'child'), path.join(root, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await matchRuntimeToProfile(root, profile(process.execPath, 'redirect'), probe))[0].requirementStatus).toBe('unknown');
    await fs.writeFile(path.join(root, 'package.json'), ' '.repeat(65537));
    expect((await matchRuntimeToProfile(root, profile(), probe))[0].requirementStatus).toBe('unknown');
  });
  it('keeps absent Java requirements, unstable versions and cancellation explicit', async () => {
    await writeManifest({ engines: { node: '*' } });
    expect((await matchRuntimeToProfile(root, profile(), { ...probe, family: 'java' }))[0].requirementStatus).toBe('unspecified');
    expect((await matchRuntimeToProfile(root, profile(), { ...probe, version: '24.0.0-rc.1' }))[0].requirementStatus).toBe('unknown');
    await expect(matchRuntimeToProfile(root, profile(), probe, AbortSignal.abort())).rejects.toThrow();
    const input = profile(); input.services[0].enabled = false;
    expect(await matchRuntimeToProfile(root, input, probe)).toEqual([]);
  });
});
