import fs from 'node:fs/promises';
import type { Dir } from 'node:fs';
import path from 'node:path';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { ExecutionReadBudget, isExecutionInputInside, withExecutionReadBudget, type ExecutionReadOptions } from './execution-input-reader.js';

const SOURCE_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.groovy', '.js', '.cjs', '.mjs', '.ts', '.tsx',
  '.cs', '.py', '.properties', '.yml', '.yaml',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.idea', '.vscode', '.venv', 'venv', 'node_modules', 'target', 'build', 'dist', 'out',
]);
export const RUNTIME_SCAN_LIMITS = Object.freeze({ entries: 10_000, files: 800, services: 256, fileBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024 });
export interface RuntimeScanOptions extends ExecutionReadOptions {
  maxEntries?: number;
  maxFiles?: number;
}

export interface RuntimeConstraintResult {
  profile: RunProfile;
  messages: string[];
}

function isMissing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

class RuntimeScan {
  private entries = 0;
  private files = 0;
  readonly seenDirectories = new Set<string>();
  constructor(readonly root: string, readonly physicalRoot: string, readonly budget: ExecutionReadBudget,
    private readonly maxEntries: number, private readonly maxFiles: number) {}

  async resolve(candidate: string): Promise<string | undefined> {
    this.budget.check();
    const absolute = path.resolve(this.root, candidate);
    if (!isExecutionInputInside(this.root, absolute)) return undefined;
    const physical = await this.budget.physical(absolute);
    return isExecutionInputInside(this.physicalRoot, physical) ? physical : undefined;
  }

  async *directory(directory: string) {
    this.budget.check();
    let handle: Dir;
    try { handle = await fs.opendir(directory, { bufferSize: 32 }); }
    catch (error) { if (isMissing(error)) return; throw error; }
    try {
      while (true) {
        this.budget.check();
        const entry = await handle.read();
        this.budget.check();
        if (!entry) return;
        if (++this.entries > this.maxEntries) throw new Error('运行配置扫描目录条目超限，请缩小项目范围。');
        yield entry;
      }
    } finally { await handle.close(); }
  }

  async text(file: string): Promise<string | undefined> {
    const physical = await this.resolve(file);
    if (!physical) return undefined;
    if (++this.files > this.maxFiles) throw new Error('运行配置扫描文件数量超限，请缩小项目范围。');
    return this.budget.text(physical);
  }
}

async function detectExplicitWindowsLauncher(scan: RuntimeScan): Promise<string | undefined> {
  const launchers: string[] = [];
  for await (const entry of scan.directory(scan.physicalRoot)) {
    if (entry.isFile() && /(?:启动|start|run|launch).*\.bat$/i.test(entry.name)) launchers.push(entry.name);
  }
  launchers.sort((left, right) => left.length - right.length);
  for (const launcher of launchers) {
    const content = await scan.text(path.join(scan.root, launcher));
    if (content === undefined) continue;
    for (const match of content.matchAll(/"([^"]*)"/g)) {
      scan.budget.candidate();
      const value = match[1];
      if (!/\.exe$/i.test(value)) continue;
      const relative = path.isAbsolute(value) ? value : value.replace(/^%~dp0/i, '');
      const physical = await scan.resolve(relative);
      if (!physical) continue;
      try {
        const stat = await fs.lstat(physical);
        scan.budget.check();
        if (stat.isFile()) return path.relative(scan.root, path.resolve(scan.root, relative)).replace(/\\/g, '/');
      } catch (error) { if (!isMissing(error)) throw error; }
    }
  }
  return undefined;
}

async function detectFixedCorsPorts(scan: RuntimeScan, backends: ServiceConfig[]): Promise<number[]> {
  const ports = new Set<number>();
  const roots = new Set<string>();
  for (const service of backends) {
    const root = await scan.resolve(service.cwdRelative || service.moduleRelativePath || '.');
    if (root) roots.add(root);
  }

  for (const root of roots) {
    const pending = [root];
    while (pending.length) {
      const current = pending.pop()!;
      const key = process.platform === 'win32' ? current.toLowerCase() : current;
      if (scan.seenDirectories.has(key)) continue;
      scan.seenDirectories.add(key);
      for await (const entry of scan.directory(current)) {
        if (entry.isSymbolicLink()) continue;
        // Use a lexical path under root for physical-boundary validation even
        // when the project itself is reached through a junction.
        const file = path.resolve(scan.root, path.relative(scan.physicalRoot, path.join(current, entry.name)));
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
            const physical = await scan.resolve(file);
            if (physical) pending.push(physical);
          }
          continue;
        }
        if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const content = await scan.text(file);
        if (content === undefined) continue;
        // A localhost URL alone may be an API endpoint. Only treat it as a
        // frontend-origin constraint when the surrounding file configures CORS.
        if (!/(?:cors|allowedOrigins?|CrossOrigin)/i.test(content)) continue;
        for (const match of content.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):(?<port>\d{2,5})/gi)) {
          const port = Number(match.groups?.port);
          if (port >= 1024 && port <= 65535) ports.add(port);
        }
      }
    }
  }
  return [...ports].sort((left, right) => left - right);
}

function withPort(service: ServiceConfig, port: number): ServiceConfig {
  return {
    ...service,
    args: [...service.args],
    env: service.env.map((entry) => ({ ...entry })),
    dependsOn: [...service.dependsOn],
    port,
    portMode: 'fixed',
    healthCheck: service.healthCheck
      ? { ...service.healthCheck, port }
      : service.healthCheck,
  };
}

/**
 * Reconcile runtime ports that cannot safely be auto-remapped. The first
 * supported case is a single frontend whose backend explicitly whitelists one
 * localhost CORS origin. Keeping that port is required for browser requests to
 * work even when both processes themselves appear healthy.
 */
export async function applyRuntimeProfileConstraints(
  projectRoot: string,
  profile: RunProfile,
  options: RuntimeScanOptions = {}
): Promise<RuntimeConstraintResult> {
  const maxEntries = options.maxEntries ?? RUNTIME_SCAN_LIMITS.entries;
  const maxFiles = options.maxFiles ?? RUNTIME_SCAN_LIMITS.files;
  for (const [value, maximum] of [[maxEntries, RUNTIME_SCAN_LIMITS.entries], [maxFiles, RUNTIME_SCAN_LIMITS.files]]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error('Invalid runtime scan limit');
  }
  if (profile.services.length > RUNTIME_SCAN_LIMITS.services) throw new Error('运行配置扫描服务数量超限。');
  return withExecutionReadBudget(async budget => {
    budget.check();
    const root = path.resolve(projectRoot);
    const scan = new RuntimeScan(root, await budget.physical(root), budget, maxEntries, maxFiles);
    return reconcileConstraints(scan, profile);
  }, { ...options, limits: {
    ...options.limits,
    fileBytes: Math.min(options.limits?.fileBytes ?? RUNTIME_SCAN_LIMITS.fileBytes, RUNTIME_SCAN_LIMITS.fileBytes),
    totalBytes: Math.min(options.limits?.totalBytes ?? RUNTIME_SCAN_LIMITS.totalBytes, RUNTIME_SCAN_LIMITS.totalBytes),
  } });
}

async function reconcileConstraints(scan: RuntimeScan, profile: RunProfile): Promise<RuntimeConstraintResult> {
  const detectedServices = profile.services.filter((service) => service.source === 'detected');
  const explicitLauncher = profile.services.length === 1 && detectedServices.length === 1
    ? await detectExplicitWindowsLauncher(scan) : undefined;
  if (explicitLauncher && profile.services.length === 1 && detectedServices.length === 1) {
    const current = detectedServices[0];
    if (current.executable !== explicitLauncher || current.args.length > 0) {
      const desktopService: ServiceConfig = {
        ...current,
        name: `${path.basename(explicitLauncher, path.extname(explicitLauncher))} Desktop`,
        type: 'tool',
        moduleRelativePath: '.',
        executable: explicitLauncher,
        args: [],
        cwdRelative: '',
        env: current.env,
        port: undefined,
        portMode: 'auto',
        healthCheck: undefined,
        dependsOn: [],
      };
      return {
        profile: { ...profile, services: [desktopService] },
        messages: [
          `[Runtime Entry] 检测到项目显式桌面启动器，已使用 ${explicitLauncher} 替代推测的 ${current.name}。`,
        ],
      };
    }
  }

  const frontends = profile.services.filter((service) => service.enabled && service.type === 'frontend');
  const backends = profile.services.filter((service) => service.enabled && service.type === 'backend');
  if (frontends.length !== 1 || backends.length === 0) {
    return { profile, messages: [] };
  }

  const corsPorts = await detectFixedCorsPorts(scan, backends);
  if (corsPorts.length !== 1) return { profile, messages: [] };

  const frontend = frontends[0];
  const requiredPort = corsPorts[0];
  if (frontend.port === requiredPort && frontend.portMode === 'fixed') {
    return { profile, messages: [] };
  }

  const services = profile.services.map((service) =>
    service.id === frontend.id ? withPort(service, requiredPort) : service
  );
  return {
    profile: { ...profile, services },
    messages: [
      `[Runtime Constraint] 后端 CORS 固定允许前端端口 ${requiredPort}，已将 ${frontend.name} 从 ${frontend.port ?? '未设置'} 调整为固定端口 ${requiredPort}。`,
    ],
  };
}
