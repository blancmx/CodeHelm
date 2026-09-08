import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openRoot, closeRoot } from '@codehelm/safe-fs';
import { workspaceInventory } from '../discovery/workspace-inventory.js';
import { WorkspaceScanner } from '../discovery/workspace-scanner.js';
import { AnalyzerEngine } from '../engine/analyzer-engine.js';
let root = '';
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-v02-scan-')); });
afterEach(async () => { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('codehelm-v02-scan-')) throw new Error('Unsafe cleanup'); await fs.rm(root, { recursive: true, force: true }); });
describe('workspace content inventories', () => {
  it('reports partial directory failures and skips junctions without inspecting their targets', async () => {
    await fs.mkdir(path.join(root, 'denied'));
    await fs.mkdir(path.join(root, 'readable'));
    await fs.writeFile(path.join(root, 'readable', 'package.json'), '{}');
    await fs.symlink(path.join(root, 'readable'), path.join(root, 'link'), 'junction');
    const realOpen = fs.opendir.bind(fs);
    const spy = vi.spyOn(fs, 'opendir').mockImplementation((async (directory: string) => {
      if (directory === path.join(root, 'denied')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return realOpen(directory);
    }) as typeof fs.opendir);
    try {
      const issues: string[] = [];
      const result = await new WorkspaceScanner().scan(root, { maxDepth: 2, onIssue: value => issues.push(value) });
      expect(issues).toEqual(expect.arrayContaining(['denied', 'link']));
      expect(result.map(item => item.relativePath)).toEqual(['readable']);
    } finally { spy.mockRestore(); }
  });
  it('detects same-size content changes, deletion and additions without reading env values', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"one"}');
    await fs.writeFile(path.join(root, '.env'), 'SECRET_VALUE');
    const read = () => { const session = openRoot(root, 20); try { return workspaceInventory(session, ['.'], []); } finally { closeRoot(session); } };
    const first = read();
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"two"}');
    expect(read().files['package.json']).not.toBe(first.files['package.json']);
    await fs.unlink(path.join(root, 'package.json'));
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages: [apps/*]');
    expect(read().files).not.toHaveProperty('package.json');
    expect(read().files).toHaveProperty('pnpm-workspace.yaml');
    expect(JSON.stringify(read())).not.toMatch(/SECRET_VALUE|\.env/);
  });
  it('scans nested monorepos with Chinese and spaces while honoring exclusions', async () => {
    for (const folder of ['外层 工程', '外层 工程/apps/web', 'archive']) {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await fs.writeFile(path.join(root, folder, 'package.json'), '{}');
    }
    const found = await new WorkspaceScanner().scan(root, { maxDepth: 4, excludeDirs: ['archive'] });
    expect(found.map(item => item.relativePath.replace(/\\/g, '/'))).toEqual(expect.arrayContaining(['外层 工程', '外层 工程/apps/web']));
    expect(found.some(item => item.relativePath === 'archive')).toBe(false);
  });
  it('marks oversize inputs unknown and rejects malformed desktop analysis manifests', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{broken');
    const result = await new AnalyzerEngine({ failOnLimit: true }).analyze(root);
    expect(result.status).toBe('failed');
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages: [');
    expect((await new AnalyzerEngine({ failOnLimit: true }).analyze(root)).status).toBe('failed');
    await fs.writeFile(path.join(root, 'package.json'), ' '.repeat(2 * 1024 * 1024 + 1));
    const session = openRoot(root, 20);
    try { expect(workspaceInventory(session, ['.'], []).issues).toContain('package.json'); }
    finally { closeRoot(session); }
  });
});
