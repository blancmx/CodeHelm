import fs from 'node:fs';
import path from 'node:path';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import { safeResolvePath } from '@codehelm/shared';

const SOURCE_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.groovy', '.js', '.cjs', '.mjs', '.ts', '.tsx',
  '.cs', '.py', '.properties', '.yml', '.yaml',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.idea', '.vscode', 'node_modules', 'target', 'build', 'dist', 'out',
]);
const MAX_FILES = 800;
const MAX_FILE_BYTES = 512 * 1024;

export interface RuntimeConstraintResult {
  profile: RunProfile;
  messages: string[];
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function detectExplicitWindowsLauncher(projectRoot: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const launchers = entries
    .filter((entry) => entry.isFile() && /(?:启动|start|run|launch).*\.bat$/i.test(entry.name))
    .sort((left, right) => left.name.length - right.name.length);
  for (const launcher of launchers) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, launcher.name), 'utf8');
      const quotedValues = [...content.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
      for (const value of quotedValues.filter((candidate) => /\.exe$/i.test(candidate))) {
        let absolute: string;
        try {
          absolute = safeResolvePath(
            projectRoot,
            path.isAbsolute(value) ? value : value.replace(/^%~dp0/i, '')
          );
        } catch {
          continue;
        }
        if (!isInside(projectRoot, absolute) || !fs.lstatSync(absolute).isFile()) continue;
        return path.relative(projectRoot, absolute).replace(/\\/g, '/');
      }
    } catch {
      // Continue with other explicit launchers.
    }
  }
  return undefined;
}

function collectCandidateFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];

  while (pending.length > 0 && files.length < MAX_FILES) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(absolute);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolute);
      }
    }
  }
  return files;
}

function detectFixedCorsPorts(projectRoot: string, backends: ServiceConfig[]): number[] {
  const ports = new Set<number>();
  const roots = new Set<string>();
  for (const service of backends) {
    try {
      roots.add(safeResolvePath(
        projectRoot,
        service.cwdRelative || service.moduleRelativePath || '.'
      ));
    } catch {
      // Ignore service roots that cross the physical workspace boundary.
    }
  }

  for (const root of roots) {
    for (const file of collectCandidateFiles(root)) {
      try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(file, 'utf8');
        // A localhost URL alone may be an API endpoint. Only treat it as a
        // frontend-origin constraint when the surrounding file configures CORS.
        if (!/(?:cors|allowedOrigins?|CrossOrigin)/i.test(content)) continue;
        for (const match of content.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):(?<port>\d{2,5})/gi)) {
          const port = Number(match.groups?.port);
          if (port >= 1024 && port <= 65535) ports.add(port);
        }
      } catch {
        // Ignore transient/unreadable generated files.
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
export function applyRuntimeProfileConstraints(
  projectRoot: string,
  profile: RunProfile
): RuntimeConstraintResult {
  const explicitLauncher = detectExplicitWindowsLauncher(projectRoot);
  const detectedServices = profile.services.filter((service) => service.source === 'detected');
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

  const corsPorts = detectFixedCorsPorts(projectRoot, backends);
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
