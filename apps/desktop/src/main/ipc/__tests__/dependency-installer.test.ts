import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceConfig } from '@codehelm/domain';
import { createDependencyInstallPlans } from '../dependency-installer.js';

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })));

vi.mock('node:child_process', () => ({ spawnSync }));

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function frontend(cwdRelative: string): ServiceConfig {
  return {
    id: cwdRelative,
    runProfileId: 'profile',
    name: cwdRelative,
    type: 'frontend',
    moduleRelativePath: cwdRelative,
    executable: 'npm',
    args: ['run', 'dev'],
    cwdRelative,
    env: [],
    dependsOn: [],
    enabled: true,
    source: 'detected',
  };
}

function pythonModule(moduleName: string): ServiceConfig {
  return {
    id: moduleName,
    runProfileId: 'profile',
    name: moduleName,
    type: 'backend',
    moduleRelativePath: '.',
    executable: 'python',
    args: ['-m', moduleName],
    cwdRelative: '',
    env: [],
    dependsOn: [],
    enabled: true,
    source: 'detected',
  };
}

describe('createDependencyInstallPlans', () => {
  it('finds a missing dependency install in a child module', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-deps-'));
    tempDirs.push(root);
    const moduleRoot = path.join(root, 'frontend');
    fs.mkdirSync(moduleRoot);
    fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(moduleRoot, 'package-lock.json'), '{}');

    expect(createDependencyInstallPlans(root, [frontend('frontend')])).toEqual([
      expect.objectContaining({ cwd: moduleRoot, executable: 'npm', args: ['install'] }),
    ]);
  });

  it('uses and deduplicates a workspace package manager root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-workspace-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    for (const name of ['web', 'admin']) {
      fs.mkdirSync(path.join(root, name));
      fs.writeFileSync(path.join(root, name, 'package.json'), '{}');
    }

    const plans = createDependencyInstallPlans(root, [frontend('web'), frontend('admin')]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ cwd: root, executable: 'pnpm', args: ['install'] });
  });

  it('skips modules that already have node_modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-ready-'));
    tempDirs.push(root);
    const moduleRoot = path.join(root, 'frontend');
    fs.mkdirSync(path.join(moduleRoot, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{}');
    expect(createDependencyInstallPlans(root, [frontend('frontend')])).toEqual([]);
  });

  it('installs a known Python runtime module when the project has no dependency manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-python-inferred-'));
    tempDirs.push(root);

    const plans = createDependencyInstallPlans(root, [pythonModule('flask')], {
      isPythonModuleAvailable: () => false,
    });

    expect(plans).toEqual([
      expect.objectContaining({
        executable: 'python',
        args: ['-m', 'pip', 'install', 'Flask'],
      }),
    ]);
  });

  it('does not reinstall an inferred Python runtime module that is available', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-python-ready-'));
    tempDirs.push(root);
    expect(createDependencyInstallPlans(root, [pythonModule('flask')], {
      isPythonModuleAvailable: () => true,
    })).toEqual([]);
  });

  it('does not execute an inferred Python import while planning an install', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-python-preview-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'flask.py'), 'raise RuntimeError("must not be imported")');
    spawnSync.mockClear();

    const plans = createDependencyInstallPlans(root, [pythonModule('flask')]);

    expect(spawnSync).not.toHaveBeenCalled();
    expect(plans).toEqual([
      expect.objectContaining({
        pythonModuleCheck: { moduleName: 'flask' },
      }),
    ]);
  });

  it('skips a module cwd that crosses a directory junction', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-deps-link-'));
    tempDirs.push(container);
    const root = path.join(container, 'project');
    const outsideModule = path.join(container, 'outside-module');
    fs.mkdirSync(root);
    fs.mkdirSync(outsideModule);
    fs.writeFileSync(path.join(outsideModule, 'package.json'), '{}');
    fs.writeFileSync(path.join(outsideModule, 'package-lock.json'), '{}');
    fs.symlinkSync(outsideModule, path.join(root, 'linked-module'), 'junction');

    expect(createDependencyInstallPlans(root, [frontend('linked-module')])).toEqual([]);
  });
});
