import fs from 'node:fs/promises';
import path from 'node:path';
import { openRoot, closeRoot, readFile, fileExists } from '@codehelm/safe-fs';
import type { ServiceConfig } from '@codehelm/domain';
import type { DiagnosticCheckDto } from '@codehelm/contracts';
import { isExecutionInputInside, type ExecutionReadBudget } from './execution-input-reader.js';

export async function diagnoseServiceInputs(root: string, cwd: string, service: ServiceConfig, budget: ExecutionReadBudget): Promise<DiagnosticCheckDto[]> {
  const checks: DiagnosticCheckDto[] = [];
  const add = (code: string, status: DiagnosticCheckDto['status'], title: string, detail: string, suggestion: string) =>
    checks.push({ code, status, title, detail, suggestion, serviceId: service.id, serviceName: service.name });
  const missing = service.env.filter(entry => entry.required && !entry.value.trim());
  add('REQUIRED_ENV', missing.length ? 'blocked' : 'passed', '必需环境变量', missing.length ? `有 ${missing.length} 个标记为必需的变量未填写。` : '显式标记为必需的变量均已填写。', '在启动配置的服务编辑器中查看“必需”标记；此检查不推断未声明的变量，也不展示变量值。');
  const references: string[] = [];
  const flags = new Set(['--config', '--env-file', '--require', '-r', '-jar']);
  for (let i = 0; i < service.args.length; i++) {
    budget.candidate();
    const arg = service.args[i];
    if (flags.has(arg)) {
      if (!service.args[i + 1] || service.args[i + 1].startsWith('-')) {
        add('REFERENCE_ARGUMENT', 'blocked', '配置引用文件', '文件参数未提供路径。', '补全 --config、--env-file、--require 或 -jar 等参数。');
      } else {
        const reference = service.args[++i];
        if (['--require', '-r'].includes(arg) && !path.isAbsolute(reference) && !reference.startsWith('.')) {
          add('REFERENCE_MODULE', 'unknown', '配置引用文件', '预加载参数为模块名称，未执行模块解析。', '请核对该模块已安装；诊断不会加载模块。');
        } else references.push(reference);
      }
    } else if (/^--(?:config|env-file|require)=/.test(arg)) {
      const reference = arg.slice(arg.indexOf('=') + 1);
      if (arg.startsWith('--require=') && reference && !path.isAbsolute(reference) && !reference.startsWith('.')) {
        add('REFERENCE_MODULE', 'unknown', '配置引用文件', '预加载参数为模块名称，未执行模块解析。', '请核对该模块已安装；诊断不会加载模块。');
      } else references.push(reference);
    }
    else if (i === 0 && /\.(?:[cm]?js|py|jar)$/i.test(arg)) references.push(arg);
  }
  for (const [index, reference] of references.entries()) {
    const target = path.resolve(cwd, reference);
    if (!isExecutionInputInside(root, target) || !isExecutionInputInside(root, await budget.physical(target))) {
      add('REFERENCE_OUTSIDE', 'unknown', '配置引用文件', `第 ${index + 1} 个文件引用位于项目外，未检查其内容。`, '请确认该外部文件可信并可用；诊断不读取项目外配置。');
      continue;
    }
    const exists = await fs.stat(target).then(value => value.isFile()).catch(error => {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
      throw error;
    });
    budget.check();
    add('REFERENCE_FILE', exists ? 'passed' : 'blocked', '配置引用文件', `第 ${index + 1} 个文件引用${exists ? '存在' : '不存在或不是普通文件'}。`, '按服务命令中的文件参数顺序定位；不会展示参数内容或读取 .env 值。');
  }
  const command = path.basename(service.executable).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  const managers = ['npm', 'pnpm', 'yarn', 'bun'];
  if (managers.includes(command)) {
    const indirectDirectory = service.args.some(arg => /^(?:--prefix|--cwd|--dir|-C)(?:=|$)/.test(arg));
    let session: string | undefined;
    try {
      if (indirectDirectory) throw new Error('Indirect package directory');
      session = openRoot(root, 128);
      const manifest = path.relative(root, path.join(cwd, 'package.json'));
      if (!fileExists(session, manifest)) {
        add('PACKAGE_MANIFEST', 'warning', '包管理器声明', '服务目录无 package.json，可能使用工作区根目录。', '核对工作目录和 workspace 参数。');
      } else {
        const data: unknown = JSON.parse(readFile(session, manifest, 65536).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid manifest');
        const declared = (data as Record<string, unknown>).packageManager;
        if (declared === undefined) add('PACKAGE_MANAGER', 'unknown', '包管理器声明', '清单未声明 packageManager。', '核对命令与锁文件来源。');
        else if (typeof declared !== 'string' || !/^(npm|pnpm|yarn|bun)@\d[^\s]*$/.test(declared)) throw new Error('Unsupported declaration');
        else add('PACKAGE_MANAGER', declared.split('@')[0] === command ? 'passed' : 'blocked', '包管理器声明', declared.split('@')[0] === command ? '命令与清单声明的包管理器一致，版本尚未验证。' : '命令与清单声明的包管理器不同。', '核对 package.json 的 packageManager 字段并修改服务命令。');
        const locks: Record<string, string[]> = { npm: ['package-lock.json', 'npm-shrinkwrap.json'], pnpm: ['pnpm-lock.yaml'], yarn: ['yarn.lock'], bun: ['bun.lock', 'bun.lockb'] };
        const detected: string[] = [];
        for (const [manager, files] of Object.entries(locks)) if (files.some(file => fileExists(session!, path.relative(root, path.join(cwd, file))))) detected.push(manager);
        add('COMMAND_LOCKFILES', detected.some(manager => manager !== command) ? 'warning' : detected.length ? 'passed' : 'unknown', '命令与锁文件', detected.some(manager => manager !== command) ? '存在其他包管理器的锁文件，安装结果可能不一致。' : detected.length ? '当前目录锁文件类型与命令一致；未验证依赖内容。' : '当前目录未找到匹配锁文件。', '保留项目实际使用的锁文件；工作区父目录锁文件不在本项检查范围。');
      }
    } catch {
      budget.check();
      add('PACKAGE_DECLARATION_UNKNOWN', 'unknown', '包管理器声明', '清单或锁文件无法安全检查，可能损坏、超限或包含链接。', '核对文件格式、大小及项目边界。');
    } finally { if (session) closeRoot(session); }
  }
  for (const folder of ['.venv', 'venv']) {
    const location = path.join(cwd, folder);
    const exists = await fs.stat(location).then(value => value.isDirectory()).catch(() => false);
    budget.check();
    if (!exists) continue;
    if (!isExecutionInputInside(root, await budget.physical(location))) {
      add('VENV_BOUNDARY', 'unknown', 'Python 虚拟环境', '虚拟环境指向项目外，未继续检查。', '核对虚拟环境位置。'); continue;
    }
    const interpreter = path.join(location, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const valid = await fs.stat(interpreter).then(value => value.isFile()).catch(() => false);
    budget.check();
    add('VENV_INTERPRETER', valid ? 'unknown' : 'warning', 'Python 虚拟环境', valid ? '虚拟环境解释器文件存在；尚未证明依赖完整或可启动。' : '虚拟环境目录存在，但解释器文件缺失。', '如方案使用此虚拟环境，修复或重新创建后再启动；诊断不会创建环境。');
  }
  return checks;
}
