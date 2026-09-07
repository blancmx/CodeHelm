import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import type { RunProfile, ServiceConfig } from '@codehelm/domain';
import type { DiagnosticCheckDto, DiagnosticStatus, ProfileDiagnosticsDto } from '@codehelm/contracts';
import { detectCycle, isPortAvailable } from '@codehelm/runner';
import { isExecutionInputInside, withExecutionReadBudget, type ExecutionReadBudget } from './execution-input-reader.js';
import { diagnoseServiceInputs } from './service-input-diagnostics.js';
import { recheckRuntimeEvidence } from './runtime-evidence.js';

// Do not expose a guessable hash of short environment secrets to the renderer.
const fingerprintKey = randomBytes(32);
const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const lockManagers = ['npm', 'npm', 'pnpm', 'yarn', 'bun', 'bun'];

export interface DiagnosticOptions {
  environment?: NodeJS.ProcessEnv;
  portAvailable?: (port: number) => Promise<boolean>;
  signal?: AbortSignal;
}

function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

async function stat(file: string, budget: ExecutionReadBudget) {
  budget.candidate();
  try {
    const result = await fs.stat(file);
    budget.check();
    return result;
  } catch (error) {
    budget.check();
    if (missing(error)) return null;
    throw error;
  }
}

function envValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const actual = Object.keys(environment).find(candidate => process.platform === 'win32'
    ? candidate.toLowerCase() === key.toLowerCase() : candidate === key);
  return actual === undefined ? undefined : environment[actual];
}

function serviceEnvironment(service: ServiceConfig, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...inherited };
  for (const entry of service.env) {
    for (const key of Object.keys(result)) {
      if (process.platform === 'win32' && key.toLowerCase() === entry.key.toLowerCase()) delete result[key];
    }
    result[entry.key] = entry.value;
  }
  return result;
}

async function executableExists(executable: string, cwd: string, environment: NodeJS.ProcessEnv, budget: ExecutionReadBudget) {
  if (!executable || executable.includes('\0') || /[\r\n]/.test(executable)) return false;
  const hasPath = path.isAbsolute(executable) || /[/\\]/.test(executable);
  const extensions = process.platform === 'win32' && !path.extname(executable)
    ? ['', '.exe', '.com', '.cmd', '.bat'] : [''];
  const searchRoots = hasPath ? [cwd] : [cwd, ...(envValue(environment, 'PATH') ?? '').split(path.delimiter)
    .map(value => value.replace(/^"|"$/g, '')).filter(Boolean)];
  for (const root of searchRoots) {
    for (const extension of extensions) {
      if ((await stat(path.resolve(cwd, root, executable + extension), budget))?.isFile()) return true;
    }
  }
  return false;
}

/** Bounded static diagnostics: read supported manifests, never env contents or execute project code. */
export async function diagnoseProfile(rootPath: string, profile: RunProfile, options: DiagnosticOptions = {}): Promise<ProfileDiagnosticsDto> {
  const environment = options.environment ?? process.env;
  const checkedAt = new Date();
  const checks: DiagnosticCheckDto[] = [];
  const add = (service: ServiceConfig | undefined, code: string, title: string, status: DiagnosticStatus, detail: string, suggestion: string) => {
    checks.push({ code, title, status, detail, suggestion, serviceId: service?.id, serviceName: service?.name });
  };
  const services = profile.services.filter(service => service.enabled);
  await withExecutionReadBudget(async budget => {
    if (services.length > 32) throw new Error('方案超过 32 个启用服务，请拆分方案后检查。');
    let root: string;
    try {
      root = await budget.physical(rootPath);
      if (!(await stat(root, budget))?.isDirectory()) {
        add(undefined, 'ROOT_MISSING', '项目目录', 'blocked', '项目目录不存在或不是文件夹。', '请修复项目路径后重新检查。');
        return;
      }
      add(undefined, 'ROOT_AVAILABLE', '项目目录', 'passed', '项目目录存在。', '目录存在不代表启动所需文件完整。');
    } catch {
      budget.check();
      add(undefined, 'ROOT_UNREADABLE', '项目目录', 'unknown', '无法检查项目目录。', '请检查目录权限或磁盘连接。');
      return;
    }
    if (!services.length) {
      add(undefined, 'NO_ENABLED_SERVICES', '启用服务', 'blocked', '当前方案没有启用的服务。', '请在启动配置中启用至少一个服务。');
      return;
    }
    const cycle = detectCycle(services);
    add(undefined, 'SERVICE_GRAPH', '服务依赖', cycle ? 'blocked' : 'passed',
      cycle ? '启用服务之间存在循环依赖。' : '启用服务之间没有循环依赖。', cycle ? '请在启动配置中移除循环依赖。' : '具体依赖可用性将逐服务检查。');
    for (const service of services) {
      budget.check();
      if (service.dependsOn.some(id => !services.some(candidate => candidate.id === id))) {
        add(service, 'DEPENDENCY_DISABLED', '依赖服务', 'blocked', '依赖的服务不存在或未启用。', '启用依赖服务，或修改依赖关系。');
      }
      let cwd: string;
      try {
        cwd = path.resolve(root, service.cwdRelative);
        if (!isExecutionInputInside(root, cwd) || !isExecutionInputInside(root, await budget.physical(cwd))) {
          add(service, 'CWD_OUTSIDE_PROJECT', '工作目录', 'blocked', '工作目录指向项目边界之外。', '请使用项目内的工作目录。');
          continue;
        }
        if (!(await stat(cwd, budget))?.isDirectory()) {
          add(service, 'CWD_MISSING', '工作目录', 'blocked', '服务工作目录不存在或不是文件夹。', '请修复启动配置中的工作目录。');
          continue;
        }
        add(service, 'CWD_AVAILABLE', '工作目录', 'passed', '服务工作目录存在且位于项目内。', '这里只检查目录，不执行任何命令。');
      } catch {
        budget.check();
        add(service, 'CWD_UNREADABLE', '工作目录', 'unknown', '无法检查服务工作目录。', '请检查权限后重试。');
        continue;
      }
      try {
        const found = await executableExists(service.executable, cwd, serviceEnvironment(service, environment), budget);
        add(service, found ? 'COMMAND_FOUND' : 'COMMAND_NOT_FOUND', '启动命令文件', found ? 'passed' : 'blocked',
          found ? '在配置路径、工作目录或 PATH 中找到命令文件。' : '在配置路径、工作目录及 PATH 中没有找到命令文件。',
          found ? '尚未运行该文件；文件存在不代表可信、可执行或版本兼容。' : '请检查运行时是否安装，以及可执行文件路径与 PATH 配置。');
      } catch {
        budget.check();
        add(service, 'COMMAND_UNKNOWN', '启动命令文件', 'unknown', '命令搜索无法完成，可能遇到访问限制或候选数量上限。', '请使用明确的可执行文件路径后重试。');
      }
      add(service, 'RUNTIME_VERSION_UNCHECKED', '运行时版本', 'unknown', '尚未取得与此方案匹配的有效版本证据；自动检查不执行版本命令。', '请核对项目所需运行时版本；不要将文件存在视为版本检查通过。');
      try { checks.push(...await diagnoseServiceInputs(root, cwd, service, budget)); }
      catch {
        budget.check();
        add(service, 'SERVICE_INPUT_UNREADABLE', '服务输入文件', 'blocked', '服务输入检查无法完成。', '核对文件权限和参数数量后重试。');
      }
      const emptyCount = service.env.filter(entry => entry.value.trim() === '').length;
      add(service, 'ENVIRONMENT_VALUES', '已配置环境变量', emptyCount ? 'warning' : 'passed',
        emptyCount ? `有 ${emptyCount} 个已配置变量为空值。` : '已配置变量没有空值。',
        '仅检查显式配置；未读取 .env，也无法推断项目未声明的必需变量。允许空值的变量无需修改。');
      if (service.port !== undefined) {
        if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) {
          add(service, 'PORT_INVALID', '服务端口', 'blocked', '端口不在 1～65535 范围内。', '请修改服务端口。');
        } else {
          try {
            const available = await (options.portAvailable ?? isPortAvailable)(service.port);
            budget.check();
            const canReassign = service.source === 'detected' && service.portMode !== 'fixed';
            add(service, available ? 'PORT_AVAILABLE' : 'PORT_UNAVAILABLE', '服务端口', available ? 'passed' : canReassign ? 'warning' : 'blocked',
              available ? `端口 ${service.port} 当前可绑定。` : `端口 ${service.port} 当前无法绑定，可能被占用或受系统限制。`,
              canReassign
                ? '自动检测方案可在启动时尝试其他端口；本次不预留端口、不结束占用进程。'
                : '此服务不能自动换端口，请修改端口或手动处理占用；运行中的本项目也可能占用端口。本次不结束任何进程。');
          } catch {
            budget.check();
            add(service, 'PORT_UNKNOWN', '服务端口', 'unknown', '无法完成端口检查。', '请稍后重试。');
          }
        }
      } else {
        add(service, 'PORT_NOT_CONFIGURED', '服务端口', 'not_applicable', '未配置需要检查的端口。', '如服务监听固定端口，可在启动配置中填写。');
      }
      try {
        // Metadata only: neither symlink targets nor manifest contents are read.
        const present = await Promise.all(lockfiles.map(async file => (await stat(path.join(cwd, file), budget))?.isFile() ?? false));
        const managers = new Set(lockManagers.filter((_, index) => present[index]));
        add(service, 'LOCKFILE_MANAGERS', '包管理器线索', managers.size > 1 ? 'warning' : managers.size ? 'unknown' : 'not_applicable',
          managers.size > 1 ? '服务目录发现多个包管理器的锁文件。' : managers.size ? '服务目录发现锁文件；尚未核对内容与命令是否一致。' : '服务目录没有 Node.js 包管理器锁文件。',
          '仅检查当前服务目录；工作区根目录的锁文件和安装完整性需要进一步核对。');
        const modules = (await stat(path.join(cwd, 'node_modules'), budget))?.isDirectory();
        const venv = (await stat(path.join(cwd, '.venv'), budget))?.isDirectory();
        add(service, 'DEPENDENCY_HINTS', '依赖目录线索', 'unknown',
          modules || venv ? '发现 node_modules 或 .venv 目录。' : '当前服务目录未发现 node_modules 或 .venv。',
          '目录存在不能证明依赖完整；也可能使用工作区共享依赖、全局环境或其他虚拟环境。');
      } catch {
        budget.check();
        add(service, 'DEPENDENCY_HINTS_UNKNOWN', '依赖目录线索', 'unknown', '依赖线索检查未完成。', '请检查访问权限；诊断不会自动安装依赖。');
      }
    }
  }, { signal: options.signal, limits: { timeoutMs: 5_000 } });
  const runtimeChecks = await recheckRuntimeEvidence(rootPath, profile, options.signal);
  for (const check of runtimeChecks) {
    const index = checks.findIndex(item => item.serviceId === check.serviceId && item.code === 'RUNTIME_VERSION_UNCHECKED');
    if (index >= 0) checks.splice(index, 1);
    checks.push(check);
  }
  return {
    profileId: profile.id, projectId: profile.projectId,
    checkedAt: checkedAt.toISOString(), expiresAt: new Date(checkedAt.getTime() + 60_000).toISOString(),
    fingerprint: createHmac('sha256', fingerprintKey).update(JSON.stringify({ profile, rootPath, environment, checks })).digest('hex'),
    checks,
  };
}
