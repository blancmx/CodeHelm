import type { DiscoveryContext } from '../types.js';
import type { ModuleType, ProjectModule } from '@codehelm/domain';
import { generateId } from '@codehelm/shared';
import path from 'node:path';

const KNOWN_FRONTEND_NAMES = ['frontend', 'web', 'client', 'ui', 'app'];
const KNOWN_BACKEND_NAMES = ['backend', 'server', 'api', 'service'];
const MODULE_MANIFESTS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
]);

function toProjectPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '') || '.';
}

export function discoverModules(context: DiscoveryContext): ProjectModule[] {
  const modules: ProjectModule[] = [];
  const moduleDirs = new Set<string>();

  // 1. Only manifests that can define a runnable module create module boundaries.
  // Lockfiles and workspace metadata are evidence, not independent applications.
  for (const manifest of context.manifests) {
    if (!MODULE_MANIFESTS.has(path.basename(manifest))) continue;
    moduleDirs.add(toProjectPath(path.dirname(manifest)));
  }

  // Pure source projects (for example a single Python game) are root modules.
  if (moduleDirs.size === 0) {
    moduleDirs.add('.');
  }

  // A root module only exists when it owns a runnable manifest or there are no submodules.
  const hasRootManifest = context.manifests.some(
    (manifest) => MODULE_MANIFESTS.has(path.basename(manifest)) && toProjectPath(path.dirname(manifest)) === '.'
  );
  if (!hasRootManifest && moduleDirs.size > 1) {
    moduleDirs.delete('.');
  }

  if (moduleDirs.size === 1 && moduleDirs.has('.')) {
    return [
      {
        id: generateId(),
        snapshotId: '',
        name: path.basename(context.projectRoot),
        relativePath: '.',
        moduleType: 'fullstack',
        technologies: [],
        suggestedCommands: [],
      },
    ];
  }

  // 2. Map detected directories to ProjectModules. Technology evidence will refine the type later.
  for (const relDir of [...moduleDirs].sort((a, b) => a.localeCompare(b))) {
    if (relDir === '.') {
      modules.push({
        id: generateId(),
        snapshotId: '',
        name: `${path.basename(context.projectRoot)} (Root)`,
        relativePath: '.',
        moduleType: 'unknown',
        technologies: [],
        suggestedCommands: [],
      });
      continue;
    }
    const baseName = path.basename(relDir).toLowerCase();
    let moduleType: ModuleType = 'unknown';

    if (KNOWN_FRONTEND_NAMES.includes(baseName)) {
      moduleType = 'frontend';
    } else if (KNOWN_BACKEND_NAMES.includes(baseName)) {
      moduleType = 'backend';
    } else if (relDir.startsWith('apps/') || relDir.startsWith('packages/')) {
      moduleType = 'tool';
    }

    modules.push({
      id: generateId(),
      snapshotId: '',
      name: path.basename(relDir),
      relativePath: relDir,
      moduleType,
      technologies: [],
      suggestedCommands: [],
    });
  }

  return modules;
}
