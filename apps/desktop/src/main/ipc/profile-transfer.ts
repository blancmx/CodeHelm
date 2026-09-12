import { randomUUID } from 'node:crypto';
import { BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProfileRepository, ProjectRepository } from '@codehelm/database';
import { IpcChannels, ProfileTemplateSchema, PROFILE_TRANSFER_MAX_BYTES, type ProfileTemplate } from '@codehelm/contracts';
import { validateProfileServices, type RunProfile, type ServiceConfig } from '@codehelm/domain';
import { encryptProfileSecrets, redactProfileSecrets } from './profile-secrets.js';
import { isExecutionInputInside, withExecutionReadBudget } from './execution-input-reader.js';
import type { RegisterIpcHandler } from './trusted-ipc.js';

const slot = /^\{\{([A-Z][A-Z0-9_]{0,79})\}\}$/;
const textSchema = z.string().max(PROFILE_TRANSFER_MAX_BYTES);
function checkArgumentPaths(args: string[]) {
  for (const arg of args) {
    if (/(?:^|=)[A-Za-z]:[\\/]|(?:^|=)[\\/]|(?:^|[=\\/])\.\.(?:[\\/]|$)/.test(arg)) throw new Error('模板参数包含绝对路径或上级目录，请使用项目内相对路径。');
  }
}
function portablePath(value: string) {
  if (!value || [...value].some(char => char.charCodeAt(0) < 32) || value.includes(':') || value.includes('\\') || path.posix.isAbsolute(value)
    || value.split('/').some(part => part === '..' || /[. ]$/.test(part) && part !== '.')) {
    throw new Error('模板目录必须是项目内相对路径，不能包含绝对路径或上级目录。');
  }
}
function runtimeStrings(service: ProfileTemplate['services'][number]) {
  return [service.executable, ...service.args, ...service.env.map(entry => entry.value),
    service.portExtractRegex, service.healthCheck?.httpPath, service.healthCheck?.logRegex].filter((v): v is string => v !== undefined);
}
export function inspectProfileTemplate(raw: unknown) {
  const text = textSchema.parse(raw);
  if (Buffer.byteLength(text, 'utf8') > PROFILE_TRANSFER_MAX_BYTES) throw new Error('模板不得超过 256 KiB。');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('模板不是有效 JSON。'); }
  const result = ProfileTemplateSchema.safeParse(parsed);
  if (!result.success) throw new Error('模板格式无效：仅支持 codehelm.run-profile 版本 1，且不允许未知字段。');
  const template = result.data;
  const variables = new Set<string>();
  for (const service of template.services) {
    portablePath(service.moduleRelativePath); portablePath(service.cwdRelative);
    for (const value of runtimeStrings(service)) {
      const match = slot.exec(value);
      if (match) variables.add(match[1]);
      else if (value.includes('{{') || value.includes('}}')) throw new Error('占位符必须独占整个字段，格式为 {{VARIABLE_NAME}}。');
      if (value.includes('\0')) throw new Error('模板字段不得包含 NUL。');
    }
    if (!slot.test(service.executable)) portablePath(service.executable);
    checkArgumentPaths(service.args);
    if (new Set(service.env.map(entry => entry.key)).size !== service.env.length) throw new Error('环境变量名称重复。');
  }
  const errors = validateProfileServices(template.services.map(service => ({ ...service, runProfileId: '', source: 'manual' })));
  if (errors.length) throw new Error(errors.join('\n'));
  return { template, variables: [...variables] };
}

export function exportProfileTemplate(profile: RunProfile): string {
  const ids = new Map(profile.services.map((s, i) => [s.id, `service_${i + 1}`]));
  const services = profile.services.map((service, index) => {
    const prefix = `SERVICE_${index + 1}`;
    const placeholder = (label: string) => `{{${prefix}_${label}}}`;
    // Never copy argument or environment values: either can contain unmarked credentials.
    const { runProfileId: _profileId, source: _source, ...rest } = service;
    return { ...rest, id: ids.get(service.id)!,
      executable: /^[A-Za-z][A-Za-z0-9_.-]*$/.test(service.executable) ? service.executable : placeholder('EXECUTABLE'),
      args: service.args.map((_arg, i) => placeholder(`ARG_${i + 1}`)),
      env: service.env.map((entry, i) => ({ key: entry.key, value: placeholder(`ENV_${i + 1}`), isSecret: entry.isSecret === true, required: true })),
      dependsOn: service.dependsOn.map(id => ids.get(id) ?? id),
      ...(service.portExtractRegex === undefined ? {} : { portExtractRegex: placeholder('PORT_REGEX') }),
      ...(service.healthCheck ? { healthCheck: { ...service.healthCheck,
        ...(service.healthCheck.httpPath === undefined ? {} : { httpPath: placeholder('HTTP_PATH') }),
        ...(service.healthCheck.logRegex === undefined ? {} : { logRegex: placeholder('LOG_REGEX') }),
      } } : {}),
    };
  });
  const text = JSON.stringify({ format: 'codehelm.run-profile', version: 1, name: profile.name, failurePolicy: profile.failurePolicy, services }, null, 2);
  inspectProfileTemplate(text);
  return text;
}

export function registerProfileTransferHandlers(handle: RegisterIpcHandler, db: DatabaseInstance) {
  const profiles = new ProfileRepository(db), projects = new ProjectRepository(db);
  const previews = new Map<string, { sender: number; expires: number; rootPath: string; identity: string; profile: RunProfile }>();
  async function inspectDirectories(projectId: string, services: ServiceConfig[]) {
    const project = projects.findById(projectId);
    if (!project) throw new Error('目标项目不存在。');
    return withExecutionReadBudget(async budget => {
      const root = await fs.realpath(project.rootPath);
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error('项目目录不可用。');
      for (const relative of new Set(services.flatMap(s => [s.cwdRelative, s.moduleRelativePath]))) {
        budget.candidate(); portablePath(relative);
        const directory = await fs.realpath(path.resolve(root, relative));
        if (!isExecutionInputInside(root, directory) || !(await fs.stat(directory)).isDirectory()) throw new Error('配置目录缺失或链接越界，请修正模板中的相对目录。');
      }
      for (const service of services) if (service.executable.includes('/')) {
        budget.candidate();
        const executable = await fs.realpath(path.resolve(root, service.cwdRelative, service.executable));
        if (!isExecutionInputInside(root, executable) || !(await fs.stat(executable)).isFile()) throw new Error('可执行文件不存在或链接越界。');
      }
      budget.check();
      return { project, identity: JSON.stringify([root, stat.dev, stat.ino]) };
    });
  }
  handle(IpcChannels.PROFILES_EXPORT_TEMPLATE, (_event, rawId) => {
    const profile = profiles.findById(z.string().uuid().parse(rawId));
    if (!profile) throw new Error('方案不存在。');
    return exportProfileTemplate(profile);
  });
  handle(IpcChannels.PROFILES_INSPECT_TEMPLATE, (_event, text) => inspectProfileTemplate(text));
  handle(IpcChannels.PROFILES_SAVE_TEMPLATE_FILE, async (event, rawId) => {
    const profile = profiles.findById(z.string().uuid().parse(rawId));
    if (!profile) throw new Error('方案不存在。');
    const text = exportProfileTemplate(profile);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('应用窗口不可用。');
    const result = await dialog.showSaveDialog(window, { title: '保存脱敏配置模板', defaultPath: 'codehelm-profile-template.json',
      filters: [{ name: 'JSON 模板', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, text, 'utf8');
    return true;
  });
  handle(IpcChannels.PROFILES_PREVIEW_IMPORT, async (event, rawInput) => {
    const input = z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(100), text: textSchema,
      values: z.record(z.string().max(8192)).refine(v => Object.keys(v).length <= 12000), }).strict().parse(rawInput);
    if (Buffer.byteLength(JSON.stringify(input.values)) > PROFILE_TRANSFER_MAX_BYTES) throw new Error('变量总大小超过 256 KiB。');
    const { template, variables } = inspectProfileTemplate(input.text);
    if (Object.keys(input.values).some(key => !variables.includes(key))) throw new Error('包含未声明变量。');
    if (variables.some(key => !Object.hasOwn(input.values, key) || !input.values[key].trim())) throw new Error('请补齐所有占位变量后再预览，缺失变量不能保存或启动。');
    function resolve(value: string): string {
      const match = slot.exec(value); const result = match ? input.values[match[1]] : value;
      if (result.includes('{{') || result.includes('}}') || result.includes('\0')) throw new Error('变量值包含未解析占位符或 NUL。');
      return result;
    }
    const id = randomUUID(), ids = new Map(template.services.map(s => [s.id, randomUUID()]));
    const services: ServiceConfig[] = template.services.map(s => ({ ...s, id: ids.get(s.id)!, runProfileId: id, source: 'manual',
      executable: resolve(s.executable), args: s.args.map(resolve), dependsOn: s.dependsOn.map(dep => ids.get(dep)!),
      env: s.env.map(e => ({ ...e, value: resolve(e.value) })),
      portExtractRegex: s.portExtractRegex === undefined ? undefined : resolve(s.portExtractRegex),
      healthCheck: s.healthCheck ? { ...s.healthCheck,
        httpPath: s.healthCheck.httpPath === undefined ? undefined : resolve(s.healthCheck.httpPath),
        logRegex: s.healthCheck.logRegex === undefined ? undefined : resolve(s.healthCheck.logRegex), } : undefined,
    }));
    for (const service of services) { portablePath(service.executable); checkArgumentPaths(service.args); }
    const checked = await inspectDirectories(input.projectId, services);
    const existingNames = profiles.findByProjectId(input.projectId).map(p => p.name);
    if (existingNames.includes(input.name)) throw new Error('方案名称已存在，请使用新名称。');
    const now = Date.now();
    for (const [key, entry] of previews) if (entry.expires < now || entry.sender === event.sender.id) previews.delete(key);
    if (previews.size >= 20) previews.delete(previews.keys().next().value!);
    const token = randomUUID();
    const profile: RunProfile = { id, projectId: input.projectId, name: input.name, isDefault: false, failurePolicy: template.failurePolicy,
      services, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    previews.set(token, { sender: event.sender.id, expires: now + 300_000, rootPath: checked.project.rootPath, identity: checked.identity,
      profile: encryptProfileSecrets(profile) as RunProfile });
    return { token, name: input.name, projectName: checked.project.name, existingNames,
      services: services.map((s, index) => ({ name: s.name, executable: s.executable, argumentCount: s.args.length,
        argumentsPreview: template.services[index].args, readiness: s.healthCheck?.type ?? 'none', cwdRelative: s.cwdRelative,
        dependencyNames: s.dependsOn.map(dep => services.find(entry => entry.id === dep)!.name), variableNames: s.env.map(e => e.key) })) };
  });
  handle(IpcChannels.PROFILES_IMPORT_TEMPLATE, async (event, rawToken) => {
    const token = z.string().uuid().parse(rawToken), entry = previews.get(token);
    if (!entry || entry.sender !== event.sender.id || entry.expires < Date.now()) throw new Error('导入预览已过期，请重新预览。');
    previews.delete(token);
    const checked = await inspectDirectories(entry.profile.projectId, entry.profile.services);
    if (checked.project.rootPath !== entry.rootPath || checked.identity !== entry.identity) throw new Error('目标项目目录已变化，请重新预览。');
    if (projects.findById(entry.profile.projectId)?.rootPath !== entry.rootPath) throw new Error('目标项目已变化。');
    if (profiles.findByProjectId(entry.profile.projectId).some(p => p.name === entry.profile.name)) throw new Error('方案名称已存在，请重新预览。');
    return redactProfileSecrets(profiles.save({ ...entry.profile, userConfirmedAt: undefined }));
  });
}
