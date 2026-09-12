import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import type { GitSummaryDto } from '@codehelm/contracts';

const MAX_BYTES = 8 * 1024 * 1024;
const gitNull = process.platform === 'win32' ? 'NUL' : os.devNull;
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
class Unsupported extends Error {}
class NotRepository extends Error {}

export function gitReadEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: gitNull, GIT_CONFIG_GLOBAL: gitNull,
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: '', GIT_PAGER: '', LC_ALL: 'C', LANG: 'C' };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const entry = Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (entry) env[key] = entry[1];
  }
  return env;
}

/** Resolve only an absolute machine installation; never use project cwd or relative PATH entries. */
export async function findGitExecutable(projectRoot: string): Promise<string | undefined> {
  const filename = process.platform === 'win32' ? 'git.exe' : 'git';
  const machine = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(base => path.join(base!, 'Git', 'cmd')) : ['/usr/bin', '/usr/local/bin'];
  const searchPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of [...machine, ...searchPath.split(path.delimiter)].slice(0, 100)) {
    if (!path.isAbsolute(directory)) continue;
    try {
      const resolved = await fs.realpath(path.join(directory, filename));
      if (inside(projectRoot, resolved) || !(await fs.stat(resolved)).isFile()) continue;
      return resolved;
    } catch { /* A missing installation is reported as unavailable. */ }
  }
  return undefined;
}

export function parseGitStatus(output: string): Pick<GitSummaryDto, 'changedFiles' | 'stagedFiles' | 'unstagedFiles' | 'untrackedFiles' | 'conflictedFiles'> {
  const counts = { changedFiles: 0, stagedFiles: 0, unstagedFiles: 0, untrackedFiles: 0, conflictedFiles: 0 };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.startsWith('# ')) continue;
    if (record.startsWith('? ')) { counts.untrackedFiles++; counts.changedFiles++; continue; }
    if (record.startsWith('! ')) continue;
    if (!/^[12u] [ .MADRCUT?!]{2} /.test(record)) throw new Error('Unsupported porcelain status');
    counts.changedFiles++;
    if (record[0] === 'u') counts.conflictedFiles++;
    if (record[2] !== '.') counts.stagedFiles++;
    if (record[3] !== '.') counts.unstagedFiles++;
    if (record[0] === '2') { if (!records[++i]) throw new Error('Missing rename source'); }
  }
  return counts;
}

const safeOptions = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${gitNull}`,
  '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'protocol.allow=never'];

/** Commands reading the original metadata never refresh the index or inspect working files.
 * Status runs against a disposable index/config, so repository filters/hooks cannot execute. */
export async function readGitSummary(projectRoot: string, options: { executable?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GitSummaryDto> {
  const checkedAt = new Date().toISOString();
  const timeout = AbortSignal.timeout(Math.min(options.timeoutMs ?? 8000, 8000));
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let temporary: string | undefined;
  try {
    const project = await fs.realpath(projectRoot);
    const git = options.executable ?? await findGitExecutable(project);
    signal.throwIfAborted();
    if (!git) return { status: 'git_unavailable', checkedAt, message: '未找到项目目录外的本机 Git 安装。' };
    async function run(args: string[], cwd = project, optional = false, input?: string): Promise<string> {
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const child = execFile(git!, [...safeOptions, ...args], { cwd, env: gitReadEnvironment(), shell: false, windowsHide: true,
          signal, timeout: 8000, maxBuffer: MAX_BYTES, encoding: 'utf8' }, (error, stdout) => {
          if (!error) resolve(stdout);
          else if (optional && (error as { code?: unknown }).code === 1) resolve('');
          else reject(error);
        });
        child.stdin?.on('error', () => { /* Process exit is handled by execFile callback. */ });
        child.stdin?.end(input);
      });
    }
    let root: string;
    try { root = (await run(['rev-parse', '--show-toplevel'])).trim(); }
    catch (error) {
      if (signal.aborted) throw error;
      // Classify only the absence of metadata; corrupt/unsafe repositories remain unknown.
      let parent = project;
      while (true) {
        let exists = false;
        try { await fs.lstat(path.join(parent, '.git')); exists = true; }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
        if (exists) throw error;
        const next = path.dirname(parent); if (next === parent) break; parent = next;
      }
      throw new NotRepository();
    }
    root = await fs.realpath(root);
    if (!inside(root, project)) throw new Unsupported('Git 工作树目录不包含此项目。');
    const gitDir = (await run(['rev-parse', '--absolute-git-dir'])).trim();
    const commonDir = path.resolve(project, (await run(['rev-parse', '--git-common-dir'])).trim());
    const rawConfig = await run(['config', '--null', '--list', '--no-includes']);
    const config = new Map(rawConfig.split('\0').filter(Boolean).map(record => {
      const offset = record.indexOf('\n'); return [offset < 0 ? record : record.slice(0, offset), offset < 0 ? '' : record.slice(offset + 1)] as const;
    }));
    // External filters change content comparisons. Refuse instead of executing them or claiming a clean tree.
    if ([...config.keys()].some(key => key.startsWith('include.') || key.startsWith('includeif.') || key.startsWith('filter.') || key === 'extensions.partialclone' || key.endsWith('.promisor')
      || key === 'extensions.worktreeconfig' || key === 'core.sparsecheckout' || key === 'core.attributesfile' || key === 'core.excludesfile')) {
      throw new Unsupported('此仓库使用过滤器、配置包含、稀疏检出或扩展配置，当前只读摘要暂不支持。');
    }
    const branch = (await run(['symbolic-ref', '--quiet', 'HEAD'], project, true)).trim();
    const oid = (await run(['rev-parse', '--verify', '--quiet', 'HEAD'], project, true)).trim();
    if (oid && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) throw new Error('Invalid object ID');
    if (branch && (!branch.startsWith('refs/heads/') || branch.includes('..') || /[\s\\]/.test(branch))) throw new Unsupported('不支持的分支引用。');
    if (!branch && !oid) throw new Error('Invalid HEAD');
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-git-summary-'));
    const snapshot = temporary;
    await fs.mkdir(path.join(snapshot, 'objects', 'info'), { recursive: true });
    await fs.mkdir(path.join(snapshot, 'refs', 'heads'), { recursive: true });
    const objects = await fs.realpath(path.join(commonDir, 'objects'));
    if (/[\r\n]/.test(objects)) throw new Unsupported('对象目录包含不支持的字符。');
    await fs.writeFile(path.join(snapshot, 'objects', 'info', 'alternates'), `${objects.replace(/\\/g, '/')}\n`);
    const lines = ['[core]', 'repositoryformatversion = ' + (config.get('extensions.objectformat') === 'sha256' ? '1' : '0'), 'bare = false', 'fsmonitor = false', 'untrackedCache = false', 'preloadIndex = false'];
    for (const key of ['ignorecase', 'filemode', 'autocrlf', 'symlinks', 'eol']) {
      const value = config.get(`core.${key}`);
      if (value && /^(true|false|input|lf|crlf|native)$/i.test(value)) lines.push(`${key} = ${value}`);
    }
    if (config.get('extensions.objectformat') === 'sha256') lines.push('[extensions]', 'objectFormat = sha256');
    await fs.writeFile(path.join(snapshot, 'config'), lines.join('\n') + '\n');
    const headRef = branch || 'refs/heads/snapshot';
    await fs.writeFile(path.join(snapshot, 'HEAD'), branch ? `ref: ${headRef}\n` : `${oid}\n`);
    if (branch && oid) { await fs.mkdir(path.dirname(path.join(snapshot, headRef)), { recursive: true }); await fs.writeFile(path.join(snapshot, headRef), `${oid}\n`); }
    async function copyMetadata(name: string, optional = false) {
      const source = path.join(gitDir, name);
      let handle;
      try { handle = await fs.open(source, 'r'); }
      catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > MAX_BYTES) throw new Unsupported('Git 索引超过 8 MiB 或不是普通文件，摘要未知。');
        const content = Buffer.alloc(before.size); let offset = 0;
        while (offset < content.length) { signal.throwIfAborted(); const { bytesRead } = await handle.read(content, offset, content.length - offset, offset); if (!bytesRead) throw new Error('Changed index'); offset += bytesRead; }
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Changed index');
        await fs.writeFile(path.join(snapshot, name), content);
        return `${before.ino}:${before.size}:${before.mtimeMs}`;
      } finally { await handle.close(); }
    }
    const indexIdentity = await copyMetadata('index', true);
    const excludePath = path.join(commonDir, 'info', 'exclude');
    const exclude = await fs.stat(excludePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (exclude) {
      if (!exclude.isFile() || exclude.size > 65536) throw new Unsupported('仓库排除规则超限。');
      const handle = await fs.open(excludePath, 'r');
      try {
        const content = Buffer.alloc(65537); const { bytesRead } = await handle.read(content, 0, content.length, 0);
        if (bytesRead > 65536) throw new Unsupported('仓库排除规则超限。');
        await fs.mkdir(path.join(snapshot, 'info')); await fs.writeFile(path.join(snapshot, 'info', 'exclude'), content.subarray(0, bytesRead));
      } finally { await handle.close(); }
    }
    // A split index needs potentially unbounded additional files; report unsupported explicitly.
    if ((await fs.readdir(gitDir)).some(name => name.startsWith('sharedindex.'))) throw new Unsupported('此仓库使用共享索引，当前摘要暂不支持。');
    const prefix = [`--git-dir=${snapshot}`, `--work-tree=${root}`];
    const tracked = await run([...prefix, 'ls-files', '-z'], root);
    if (tracked) {
      const attributes = (await run([...prefix, 'check-attr', '-z', '--stdin', 'filter', 'working-tree-encoding'], root, false, tracked)).split('\0');
      for (let i = 2; i < attributes.length; i += 3) {
        if (!['unspecified', 'unset'].includes(attributes[i])) throw new Unsupported('仓库文件使用内容过滤或特殊编码，当前只读摘要暂不支持。');
      }
    }
    const output = await run([...prefix, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=all', '--no-renames'], snapshot);
    const counts = parseGitStatus(output);
    let latestCommit: GitSummaryDto['latestCommit'];
    if (oid) {
      const result = await run([...prefix, 'log', '-1', '--no-show-signature', '--no-decorate', '--no-notes', '--format=%H%x00%s', oid, '--'], snapshot);
      const [hash, subject] = result.split('\0');
      if (hash !== oid || subject === undefined) throw new Error('Invalid commit');
      latestCommit = { hash, subject: subject.trim().slice(0, 240) };
    }
    const currentIndex = await fs.stat(path.join(gitDir, 'index')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const currentIdentity = currentIndex ? `${currentIndex.ino}:${currentIndex.size}:${currentIndex.mtimeMs}` : '';
    if (currentIdentity !== indexIdentity || (await run(['rev-parse', '--verify', '--quiet', 'HEAD'], project, true)).trim() !== oid
      || (await run(['symbolic-ref', '--quiet', 'HEAD'], project, true)).trim() !== branch) throw new Error('Repository changed while reading');
    signal.throwIfAborted();
    return { status: 'ready', checkedAt, repositoryRoot: root, branch: branch ? branch.slice(11) : undefined,
      detached: !branch, unborn: !oid, ...counts, latestCommit };
  } catch (error) {
    if (signal.aborted) return { status: timeout.aborted ? 'timeout' : 'unknown', checkedAt, message: 'Git 查询超时或已取消，请稍后刷新。' };
    if (error instanceof NotRepository) return { status: 'not_repository', checkedAt, message: '此项目不在 Git 工作树中。' };
    if (error instanceof Unsupported) return { status: 'unsupported', checkedAt, message: error.message };
    return { status: 'unknown', checkedAt, message: 'Git 状态未知：仓库不可用、权限不足、输出超限或查询期间状态变化。' };
  } finally {
    if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('codehelm-git-summary-')) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
