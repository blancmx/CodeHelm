import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, fileExists } from '@codehelm/safe-fs';
import type { WorkspaceInventory } from '@codehelm/contracts';

// Content hashes only: no environment files, source contents or execution.
export const WORKSPACE_INPUTS = ['.gitignore', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'index.html'];

export function workspaceInventory(session: string, directories: string[], issues: string[]): WorkspaceInventory {
  const result: WorkspaceInventory = { files: {}, directories, issues: issues.map(issue => issue.replace(/\\/g, '/')) };
  let total = 0;
  for (const dir of directories) {
    for (const name of WORKSPACE_INPUTS) {
      const relative = path.posix.join(dir.replace(/\\/g, '/'), name);
      try {
        if (!fileExists(session, relative)) continue;
        if (total >= 32 * 1024 * 1024) throw new Error('Read budget');
        const bytes = readFile(session, relative, Math.min(2 * 1024 * 1024, 32 * 1024 * 1024 - total));
        total += bytes.length;
        result.files[relative] = createHash('sha256').update(bytes).digest('hex');
      } catch {
        result.issues.push(relative);
      }
    }
  }
  result.issues = [...new Set(result.issues)].slice(0, 2000);
  return result;
}
