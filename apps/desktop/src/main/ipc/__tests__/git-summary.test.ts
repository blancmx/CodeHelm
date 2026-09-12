import { beforeEach, afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findGitExecutable, gitReadEnvironment, parseGitStatus, readGitSummary } from '../git-summary.js';
let root: string, repo: string, git: string;
function command(args: string[], cwd = repo) {
  return execFileSync(git, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
    cwd, env: gitReadEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-git-test-'));
  repo = path.join(root, '中文 项目'); await fs.mkdir(repo);
  git = (await findGitExecutable(root))!; expect(git).toBeTruthy();
  command(['init', '-b', 'main']); command(['config', 'core.autocrlf', 'false']);
});
afterEach(async () => {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-git-test-')) throw new Error('unsafe cleanup');
  await fs.rm(root, { recursive: true, force: true });
});
async function commit() { await fs.writeFile(path.join(repo, '已跟踪.txt'), 'one\n'); command(['add', '.']); command(['commit', '-m', '中文初始提交']); }
async function inventory(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(file));
    else { const stat = await fs.stat(file); result.push(`${path.relative(root, file)}:${stat.mtimeMs}:${createHash('sha256').update(await fs.readFile(file)).digest('hex')}`); }
  }
  return result.sort();
}
it('reads an unborn branch and untracked files including nested Chinese paths', async () => {
  await fs.mkdir(path.join(repo, '目录')); await fs.writeFile(path.join(repo, '目录', '文件.txt'), 'new');
  const result = await readGitSummary(repo, { executable: git });
  expect(result).toMatchObject({ status: 'ready', branch: 'main', unborn: true, changedFiles: 1, untrackedFiles: 1 });
  expect(result.latestCommit).toBeUndefined();
});
it('reports staged and unstaged changes without modifying any source or Git metadata', async () => {
  await commit();
  await fs.writeFile(path.join(repo, '已跟踪.txt'), 'two\n'); command(['add', '.']);
  await fs.writeFile(path.join(repo, '已跟踪.txt'), 'three\n');
  await fs.writeFile(path.join(repo, '新文件.txt'), 'new');
  const before = await inventory(repo);
  const result = await readGitSummary(repo, { executable: git });
  expect(result).toMatchObject({ status: 'ready', branch: 'main', changedFiles: 2, stagedFiles: 1, unstagedFiles: 1, untrackedFiles: 1,
    latestCommit: { subject: '中文初始提交' } });
  expect(await inventory(repo)).toEqual(before);
});
it('handles linked worktrees, nested projects and detached HEAD', async () => {
  await commit();
  const linked = path.join(root, 'linked 中文'); command(['worktree', 'add', '-b', 'feature', linked]);
  await fs.mkdir(path.join(linked, 'nested'));
  expect(await readGitSummary(path.join(linked, 'nested'), { executable: git })).toMatchObject({ status: 'ready', branch: 'feature', changedFiles: 0 });
  command(['checkout', '--detach'], linked);
  expect(await readGitSummary(linked, { executable: git })).toMatchObject({ status: 'ready', detached: true });
});
it('does not run repository hooks or fsmonitor helpers and never fetches a remote', async () => {
  await commit();
  const marker = path.join(root, 'executed');
  const helper = path.join(root, 'helper.sh'); await fs.writeFile(helper, `#!/bin/sh\necho invoked > '${marker.replace(/\\/g, '/')}'\n`);
  command(['config', 'core.fsmonitor', helper]); command(['config', 'core.hooksPath', root]);
  command(['config', 'remote.origin.url', `ext::sh ${helper}`]); command(['config', 'protocol.ext.allow', 'always']);
  const before = await inventory(repo);
  expect((await readGitSummary(repo, { executable: git })).status).toBe('ready');
  expect(await fs.stat(marker).then(() => true, () => false)).toBe(false);
  expect(await inventory(repo)).toEqual(before);
});
it('rejects configured clean filters without executing them or showing a clean status', async () => {
  await commit(); command(['config', 'filter.evil.clean', 'echo should-not-run']);
  await fs.writeFile(path.join(repo, '.gitattributes'), '*.txt filter=evil\n');
  const result = await readGitSummary(repo, { executable: git });
  expect(result.status).toBe('unsupported'); expect(result.changedFiles).toBeUndefined();
});
it('rejects filter attributes even when no driver is installed and bounds a slow query', async () => {
  await commit(); await fs.writeFile(path.join(repo, '.gitattributes'), '*.txt filter=lfs\n');
  expect((await readGitSummary(repo, { executable: git })).status).toBe('unsupported');
  expect((await readGitSummary(repo, { executable: git, timeoutMs: 1 })).status).toBe('timeout');
});
it('respects repository ignore files and info/exclude', async () => {
  await commit(); await fs.writeFile(path.join(repo, '.gitignore'), 'ignored.txt\n'); command(['add', '.']); command(['commit', '-m', 'ignore']);
  await fs.appendFile(path.join(repo, '.git', 'info', 'exclude'), '\nlocal.txt\n');
  await fs.writeFile(path.join(repo, 'ignored.txt'), 'ignored'); await fs.writeFile(path.join(repo, 'local.txt'), 'excluded');
  expect(await readGitSummary(repo, { executable: git })).toMatchObject({ status: 'ready', changedFiles: 0 });
});
it('shows nonrepository, missing executable, unsupported index and cancellation as non-ready', async () => {
  const plain = path.join(root, 'plain'); await fs.mkdir(plain);
  expect((await readGitSummary(plain, { executable: git })).status).toBe('not_repository');
  expect((await readGitSummary(repo, { executable: path.join(root, 'missing.exe') })).status).toBe('unknown');
  const controller = new AbortController(); controller.abort();
  expect((await readGitSummary(repo, { executable: git, signal: controller.signal })).status).toBe('unknown');
  await fs.writeFile(path.join(repo, '.git', 'index'), Buffer.alloc(8 * 1024 * 1024 + 1));
  expect((await readGitSummary(repo, { executable: git })).status).toBe('unsupported');
});
it('parses NUL records without treating rename-source paths as changes', () => {
  const result = parseGitStatus('2 R. N... 100644 100644 100644 aaa bbb R100 renamed\0original\0? 中文\n文件\0u UU N... fields\0');
  expect(result).toEqual({ changedFiles: 3, stagedFiles: 2, unstagedFiles: 1, untrackedFiles: 1, conflictedFiles: 1 });
  expect(() => parseGitStatus('unrecognized\0')).toThrow();
});
it('clears inherited execution and Git injection environment variables', () => {
  const previous = process.env.GIT_CONFIG_COUNT; process.env.GIT_CONFIG_COUNT = '99';
  try { const env = gitReadEnvironment(); expect(env.GIT_CONFIG_COUNT).toBeUndefined(); expect(env.GIT_ALLOW_PROTOCOL).toBe(''); expect(env.GIT_OPTIONAL_LOCKS).toBe('0'); expect(env.PATH).toBe(''); }
  finally { if (previous === undefined) delete process.env.GIT_CONFIG_COUNT; else process.env.GIT_CONFIG_COUNT = previous; }
});
