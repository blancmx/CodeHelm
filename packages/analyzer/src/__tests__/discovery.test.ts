import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiscoveryEngine } from '../discovery/discovery-engine.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Discovery Engine', () => {
  let tempDir: string;
  let discovery: DiscoveryEngine;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `codehelm-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Create fake files
    await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'vite.config.ts'), '');
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/main.ts'), '');
    await fs.writeFile(path.join(tempDir, 'src/App.vue'), '');

    // Ignored directories
    await fs.mkdir(path.join(tempDir, 'node_modules/fake-lib'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'node_modules/fake-lib/index.js'), '');
    await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.git/config'), '');
    await fs.mkdir(path.join(tempDir, 'backend/.venv/Lib/site-packages/pandas'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'backend/.venv/Lib/site-packages/pandas/__init__.py'), '');

    discovery = new DiscoveryEngine();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should discover files and ignore node_modules and .git by default', async () => {
    const context = await discovery.discover(tempDir);
    expect(context.files.length).toBe(4);
    expect(context.files).toContain('package.json');
    expect(context.files).toContain('vite.config.ts');
    expect(context.files).toContain('src/main.ts');
    expect(context.files).toContain('src/App.vue');
    expect(context.files.some((file) => file.includes('.venv'))).toBe(false);

    expect(context.manifests).toContain('package.json');
    expect(context.configFiles).toContain('vite.config.ts');
  });

  it('should respect custom .gitignore', async () => {
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'src/secret.txt\n');
    await fs.writeFile(path.join(tempDir, 'src/secret.txt'), 'secret');

    const context = await discovery.discover(tempDir);
    expect(context.files).not.toContain('src/secret.txt');
  });
});
