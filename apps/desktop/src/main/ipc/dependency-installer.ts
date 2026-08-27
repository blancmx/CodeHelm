import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ServiceConfig } from '@codehelm/domain';
import { safeResolvePath } from '@codehelm/shared';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DependencyInstallPlan {
  key: string;
  label: string;
  cwd: string;
  executable: string;
  args: string[];
  // Availability checks are deferred because probing a Python module can execute project code.
  pythonModuleCheck?: {
    moduleName: string;
  };
}

export interface DependencyInstallPlanOptions {
  isPythonModuleAvailable?: (executable: string, moduleName: string, cwd: string) => boolean;
}

export function checkPythonModuleAvailable(
  executable: string,
  moduleName: string,
  cwd: string
): boolean {
  return spawnSync(executable, ['-c', `import ${moduleName}`], {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
  }).status === 0;
}

const PYTHON_MODULE_PACKAGES: Record<string, string> = {
  flask: 'Flask',
  uvicorn: 'uvicorn',
  fastapi: 'fastapi',
  django: 'Django',
  streamlit: 'streamlit',
  gradio: 'gradio',
};

const MANAGER_LOCKFILES: Array<[PackageManager, string[]]> = [
  ['pnpm', ['pnpm-lock.yaml']],
  ['bun', ['bun.lock', 'bun.lockb']],
  ['yarn', ['yarn.lock']],
  ['npm', ['package-lock.json', 'npm-shrinkwrap.json']],
];

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.lstatSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function findManagerRoot(projectRoot: string, moduleRoot: string): { manager: PackageManager; root: string } {
  let current = moduleRoot;
  while (isInside(projectRoot, current)) {
    for (const [manager, lockfiles] of MANAGER_LOCKFILES) {
      if (lockfiles.some((file) => isRegularFile(path.join(current, file)))) {
        return { manager, root: current };
      }
    }
    if (current === projectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { manager: 'npm', root: moduleRoot };
}

function serviceRoot(projectRoot: string, service: ServiceConfig): string {
  return path.resolve(safeResolvePath(
    projectRoot,
    service.cwdRelative || service.moduleRelativePath || '.'
  ));
}

export function createDependencyInstallPlans(
  projectRoot: string,
  services: ServiceConfig[],
  options: DependencyInstallPlanOptions = {}
): DependencyInstallPlan[] {
  const normalizedRoot = path.resolve(projectRoot);
  const plans = new Map<string, DependencyInstallPlan>();
  const isPythonModuleAvailable = options.isPythonModuleAvailable;

  for (const service of services.filter((entry) => entry.enabled)) {
    let moduleRoot: string;
    try {
      moduleRoot = serviceRoot(normalizedRoot, service);
    } catch {
      // A cwd/module path that crosses a symlink boundary is not an
      // installable project path.
      continue;
    }
    if (!isInside(normalizedRoot, moduleRoot)) continue;

    if (isRegularFile(path.join(moduleRoot, 'package.json'))) {
      const { manager, root: installRoot } = findManagerRoot(normalizedRoot, moduleRoot);
      const moduleReady = isDirectory(path.join(moduleRoot, 'node_modules'));
      const workspaceReady = isDirectory(path.join(installRoot, 'node_modules'));
      if (!moduleReady && !workspaceReady) {
        const key = `node:${manager}:${installRoot.toLowerCase()}`;
        plans.set(key, {
          key,
          label: `${path.relative(normalizedRoot, moduleRoot) || '.'} (${manager})`,
          cwd: installRoot,
          executable: manager,
          args: ['install'],
        });
      }
    }

    const requirements = path.join(moduleRoot, 'requirements.txt');
    if (isRegularFile(requirements)) {
      const key = `python:${moduleRoot.toLowerCase()}`;
      plans.set(key, {
        key,
        label: `${path.relative(normalizedRoot, moduleRoot) || '.'} (Python)`,
        cwd: moduleRoot,
        executable: 'python',
        args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      });
    } else if (/^(?:python(?:\.exe)?|py(?:\.exe)?|.*[\\/]python(?:\.exe)?)$/i.test(service.executable)) {
      const moduleFlag = service.args.findIndex((arg) => arg === '-m');
      const moduleName = moduleFlag >= 0 ? service.args[moduleFlag + 1]?.toLowerCase() : undefined;
      const packageName = moduleName ? PYTHON_MODULE_PACKAGES[moduleName] : undefined;
      if (
        moduleName
        && packageName
        && (!isPythonModuleAvailable || !isPythonModuleAvailable(service.executable, moduleName, moduleRoot))
      ) {
        const key = `python-inferred:${service.executable.toLowerCase()}:${moduleName}:${moduleRoot.toLowerCase()}`;
        plans.set(key, {
          key,
          label: `${path.relative(normalizedRoot, moduleRoot) || '.'} (${packageName}, inferred if missing)`,
          cwd: moduleRoot,
          executable: service.executable,
          args: ['-m', 'pip', 'install', packageName],
          pythonModuleCheck: options.isPythonModuleAvailable ? undefined : { moduleName },
        });
      }
    }
  }

  return [...plans.values()];
}
