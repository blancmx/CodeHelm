import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceScanner } from '../discovery/workspace-scanner.js';

describe('WorkspaceScanner import preview', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-workspace-scanner-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('infers a nested FastAPI entry variable and uv commands', async () => {
    await fs.mkdir(path.join(tempDir, 'app'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'pyproject.toml'),
      '[project]\nname = "nested-api"\ndependencies = ["fastapi", "uvicorn"]\n[tool.uv]\n'
    );
    await fs.writeFile(path.join(tempDir, 'uv.lock'), 'version = 1');
    await fs.writeFile(
      path.join(tempDir, 'app', 'server.py'),
      'from fastapi import FastAPI\napi = FastAPI()\n'
    );

    const [project] = await new WorkspaceScanner().scan(tempDir, { maxDepth: 0 });

    expect(project.framework).toBe('FastAPI Backend');
    expect(project.tags).toEqual(expect.arrayContaining(['FastAPI', 'Backend']));
    expect(project.recommendedInstallCommand).toBe('uv sync');
    expect(project.recommendedRunCommand).toBe('uv run uvicorn app.server:api --reload --port 8000');
  });

  it('inherits the workspace package manager and reads a declared script port', async () => {
    await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await fs.mkdir(path.join(tempDir, 'apps', 'web'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps', 'web', 'package.json'),
      JSON.stringify({
        name: 'web',
        scripts: { dev: 'vite --port 4310' },
        dependencies: { vue: '^3.5.0' },
        devDependencies: { vite: '^6.0.0', typescript: '^5.7.0' },
      })
    );

    const projects = await new WorkspaceScanner().scan(tempDir, { maxDepth: 2 });
    const web = projects.find((project) => project.name === 'web');

    expect(web?.framework).toBe('Vite (Vue 3)');
    expect(web?.recommendedRunCommand).toBe('pnpm run dev');
    expect(web?.port).toBe(4310);
    expect(web?.tags).toEqual(expect.arrayContaining(['Vue 3', 'Vite', 'TypeScript']));
  });

  it('does not inspect a project reached through a directory junction', async () => {
    const outsideProject = path.join(tempDir, 'outside-project');
    await fs.mkdir(outsideProject);
    await fs.writeFile(
      path.join(outsideProject, 'package.json'),
      JSON.stringify({ name: 'outside-project', scripts: { start: 'node server.js' } })
    );
    await fs.symlink(outsideProject, path.join(tempDir, 'linked-project'), 'junction');

    const projects = await new WorkspaceScanner().scan(tempDir, { maxDepth: 1 });

    expect(projects.some((project) => project.rootPath.endsWith('linked-project'))).toBe(false);
    expect(projects.some((project) => project.name === 'outside-project')).toBe(true);
  });

  it('rejects invalid scan depth instead of recursing without a bound', async () => {
    await expect(new WorkspaceScanner().scan(tempDir, { maxDepth: Number.POSITIVE_INFINITY }))
      .rejects.toThrow('workspace scan depth');
  });
});
