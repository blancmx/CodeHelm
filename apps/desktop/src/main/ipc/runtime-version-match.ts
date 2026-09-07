import path from 'node:path';
import { closeRoot, openRoot, readFile, fileExists } from '@codehelm/safe-fs';
import type { RunProfile } from '@codehelm/domain';
import type { RuntimeProbeDto, RuntimeServiceMatchDto } from '@codehelm/contracts';
import { isExecutionInputInside, withExecutionReadBudget } from './execution-input-reader.js';
import { parsePythonRequirement, readPythonRequirement } from './python-version-requirement.js';
import { parseJavaRequirement, readJavaRequirement } from './java-version-requirement.js';

type Version = [number, number, number];
type Predicate = (version: Version) => boolean;
const numberPart = '(?:0|[1-9]\\d{0,7})';
const fullVersion = new RegExp(`^(${numberPart})\\.(${numberPart})\\.(${numberPart})$`);
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function version(value: string): Version | null {
  const match = fullVersion.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// Deliberately finite npm-compatible subset. Validate the ENTIRE expression
// before evaluating: an unsupported OR branch must never become a false pass.
export function parseNodeRequirement(value: unknown): ((value: string) => boolean | null) | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) return null;
  const groups = value.trim().split(/\s*\|\|\s*/);
  if (groups.length > 8) return null;
  const parsed: Predicate[][] = [];
  for (const group of groups) {
    const tokens = group.trim().split(/\s+/);
    if (tokens.length > 16) return null;
    const predicates: Predicate[] = [];
    for (const token of tokens) {
      if (token === '*') { predicates.push(() => true); continue; }
      const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
      if (!match) return null;
      const operator = match[1] ?? '=';
      let target = version(match[2]);
      // >=22 and <25 have unambiguous lower-bound expansion to x.0.0.
      if (!target && ['>=', '<'].includes(operator) && new RegExp(`^${numberPart}(?:\\.${numberPart})?$`).test(match[2])) {
        target = [...match[2].split('.').map(Number), 0, 0].slice(0, 3) as Version;
      }
      if (!target) return null;
      const bound = target;
      if (operator === '^' || operator === '~') {
        const upper: Version = operator === '~' ? [bound[0], bound[1] + 1, 0]
          : bound[0] > 0 ? [bound[0] + 1, 0, 0]
            : bound[1] > 0 ? [0, bound[1] + 1, 0] : [0, 0, bound[2] + 1];
        predicates.push(actual => compare(actual, bound) >= 0 && compare(actual, upper) < 0);
      } else {
        predicates.push(actual => {
          const result = compare(actual, bound);
          return operator === '>=' ? result >= 0 : operator === '<=' ? result <= 0
            : operator === '>' ? result > 0 : operator === '<' ? result < 0 : result === 0;
        });
      }
    }
    parsed.push(predicates);
  }
  return actual => {
    const parsedVersion = version(actual);
    return parsedVersion ? parsed.some(group => group.every(predicate => predicate(parsedVersion))) : null;
  };
}

export async function matchRuntimeToProfile(rootPath: string, profile: RunProfile, probe: RuntimeProbeDto, signal?: AbortSignal): Promise<RuntimeServiceMatchDto[]> {
  return withExecutionReadBudget(async budget => {
    const services = profile.services.filter(service => service.enabled);
    if (services.length > 32) throw new Error('Too many services');
    const root = await budget.physical(rootPath);
    let session: string | undefined;
    const matches: RuntimeServiceMatchDto[] = [];
    try {
      for (const service of services) {
        budget.check();
        const result: RuntimeServiceMatchDto = {
          serviceId: service.id, serviceName: service.name, commandMatch: 'unknown', requirementStatus: 'unknown',
          detail: '未匹配直接运行时路径。PATH 简写、包管理器和 wrapper 间接调用暂不推断。',
        };
        matches.push(result);
        if (!path.isAbsolute(service.executable) && !/[/\\]/.test(service.executable)) continue;
        try {
          const cwd = path.resolve(root, service.cwdRelative || '.');
          if (!isExecutionInputInside(root, cwd) || !isExecutionInputInside(root, await budget.physical(cwd))) {
            result.detail = '服务工作目录超出项目边界，无法匹配。';
            continue;
          }
          const executable = await budget.physical(path.resolve(cwd, service.executable));
          const equal = process.platform === 'win32'
            ? executable.toLowerCase() === probe.executablePath.toLowerCase() : executable === probe.executablePath;
          result.commandMatch = equal ? 'matched' : 'different';
          if (!equal) { result.detail = '方案显式命令路径与所选程序不同，此版本不用于判断该服务。'; continue; }
          const fileName = probe.family === 'java' ? 'pom.xml' : probe.family === 'python' ? 'pyproject.toml' : 'package.json';
          const field = probe.family === 'java' ? 'Maven Enforcer requireJavaVersion（构建 JVM）' : probe.family === 'python' ? 'project.requires-python' : 'engines.node';
          session ??= openRoot(root, 128);
          const manifest = path.relative(root, path.join(cwd, fileName));
          result.source = `${manifest.replace(/\\/g, '/')} → ${field}`;
          if (!fileExists(session, manifest)) {
            result.requirementStatus = 'unspecified';
            result.detail = `已匹配直接路径；服务目录无 ${fileName}，未向父目录或其他声明来源推断版本要求。`;
            continue;
          }
          budget.candidate();
          const text = readFile(session, manifest, 64 * 1024).toString('utf8');
          budget.check();
          let requirement: unknown;
          if (probe.family === 'java') {
            requirement = readJavaRequirement(text);
          } else if (probe.family === 'python') {
            requirement = readPythonRequirement(text);
          } else {
            const data: unknown = JSON.parse(text);
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid manifest');
            const engines: unknown = (data as Record<string, unknown>).engines;
            if (engines !== undefined && (!engines || typeof engines !== 'object' || Array.isArray(engines))) throw new Error('Invalid engines');
            requirement = (engines as Record<string, unknown> | undefined)?.node;
          }
          if (requirement === undefined) {
            result.requirementStatus = 'unspecified';
            result.detail = `已匹配直接路径；服务清单未声明 ${field}，不代表兼容性已验证。`;
            continue;
          }
          const evaluate = probe.family === 'java' ? parseJavaRequirement(requirement) : probe.family === 'python' ? parsePythonRequirement(requirement) : parseNodeRequirement(requirement);
          if (!evaluate) { result.detail = '已匹配直接路径；版本要求格式无效或超出当前支持范围，请人工核对。'; continue; }
          result.requirement = (requirement as string).trim();
          const satisfied = probe.version ? evaluate(probe.version) : null;
          result.requirementStatus = satisfied === null ? 'unknown' : satisfied ? 'satisfied' : 'unsatisfied';
          result.detail = satisfied === null ? '已匹配直接路径，但所选程序没有可比较的稳定版本。'
            : satisfied ? '所选程序与直接命令路径一致，版本满足此服务清单声明。'
              : '所选程序与直接命令路径一致，版本不满足此服务清单声明；请调整运行时后重新检查。';
          if (probe.family === 'java') result.detail += ' 仅比较本地 Maven 构建 JVM 声明，未证明 Maven 实际使用此程序或项目运行兼容性。';
        } catch {
          budget.check();
          result.requirementStatus = 'unknown';
          result.detail = '文件缺失、无法读取、超出读取限制、清单格式错误或动态声明，未确定版本兼容性。';
        }
      }
      return matches;
    } finally { if (session) closeRoot(session); }
  }, { signal, limits: { timeoutMs: 5_000 } });
}
