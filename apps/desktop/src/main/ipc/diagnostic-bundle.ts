import { DIAGNOSTIC_BUNDLE_MAX_BYTES, type DiagnosticBundleEntry, type DiagnosticBundleInput,
  type ProfileDiagnosticsDto, type RunSessionDto, type StoredLogPage } from '@codehelm/contracts';

export const BUNDLE_NOTICE = '仅包含选定会话与时间范围内的有限记录，不是完整日志。自动脱敏无法识别所有自定义敏感文本，请逐项检查并排除后再保存。';

/** Redact before retaining any preview. Omit text altogether if the dictionary exceeds its budget. */
export function createBundleRedactor(values: string[], roots: string[]) {
  const secrets = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (secrets.length > 1024 || secrets.reduce((sum, value) => sum + value.length, 0) > 65536) {
    throw new Error('Redaction dictionary exceeds budget');
  }
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const secretPattern = secrets.length ? new RegExp(secrets.map(escape).join('|'), 'g') : undefined;
  const paths = new Map<string, string>();
  const alias = (value: string) => {
    const key = value.replaceAll('\\', '/').toLowerCase();
    if (!paths.has(key)) paths.set(key, `[PATH_${paths.size + 1}]`);
    return paths.get(key)!;
  };
  const knownRoots = roots.filter(Boolean).sort((a, b) => b.length - a.length);
  return (raw: string): string => {
    // Redact the whole bounded input before shortening: never expose a cut-off secret prefix.
    let text = raw;
    for (const root of knownRoots) text = text.replace(new RegExp(escape(root).replace(/\\\\/g, '[\\\\/]'), 'gi'), alias(root));
    text = text.replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi, '[URL]');
    text = text.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[CREDENTIAL]');
    text = text.replace(/\b[\w-]*(?:token|password|passwd|secret|api[_-]?key|authorization|cookie)[\w-]*["']?\s*(?:[=:]|\s)\s*[^\r\n]*/gi, '[CREDENTIAL]');
    text = text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, '[PRIVATE_KEY]');
    text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
    // Quoted paths can contain spaces. For unquoted paths prefer over-redaction to disclosing a suffix.
    text = text.replace(/["'](?:[A-Za-z]:[\\/]|\\\\|\/)[^"'\r\n]*["']/g, match => alias(match.slice(1, -1)));
    text = text.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?=[A-Za-z._-]))[^\r\n"'<>|,;]*/g, alias);
    // An inherited value such as SystemDrive=C: must not destroy a path before detection.
    // Keep generated placeholders intact even when a short environment value equals a digit.
    if (secretPattern) text = text.split(/(\[(?:PATH_\d+|URL|CREDENTIAL|PRIVATE_KEY|EMAIL)\])/g)
      .map((part, index) => index % 2 ? part : part.replace(secretPattern, '[REDACTED]')).join('');
    return text.length > 4096 ? text.slice(0, 4096) + '[TRUNCATED]' : text;
  };
}

const iso = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function buildDiagnosticBundle(input: {
  selection: DiagnosticBundleInput; run: RunSessionDto; version: string;
  report?: ProfileDiagnosticsDto; logs?: StoredLogPage; redact?: (text: string) => string;
  warnings: string[];
}) {
  const warnings = [...input.warnings, BUNDLE_NOTICE];
  const entries: DiagnosticBundleEntry[] = [];
  const add = (id: string, label: string, data: unknown) => entries.push({ id, label, content: JSON.stringify(data, null, 2) });
  add('application', '应用版本与范围', { format: 'codehelm.diagnostic-bundle', version: 1, appVersion: input.version,
    from: iso(input.selection.from), to: iso(input.selection.to), platform: 'win32', uploaded: false });
  const serviceIds = new Map(input.run.services.map((service, index) => [service.id, `SERVICE_${index + 1}`]));
  add('session', '会话状态与错误码', { status: input.run.status, startedAt: iso(input.run.startedAt), stoppedAt: iso(input.run.stoppedAt),
    servicesTruncated: !!input.run.servicesTruncated,
    services: input.run.services.map(service => ({ service: serviceIds.get(service.id), status: service.status,
      exitCode: service.exitCode ?? null, errorCode: service.errorMessage ? 'SERVICE_ERROR_RECORDED' : null,
      startedAt: iso(service.startedAt), stoppedAt: iso(service.stoppedAt) })) });
  if (input.report) add('diagnostics', '当前方案的只读环境诊断', { checkedAt: iso(input.report.checkedAt), scope: 'current-profile-not-historical',
    checks: input.report.checks.slice(0, 500).map(check => ({ code: /^[A-Z0-9_:-]{1,100}$/i.test(check.code) ? check.code : 'UNKNOWN_CHECK', status: check.status })) });
  else warnings.push('当前方案诊断不可用；方案可能已删除、已变化或检查失败。');
  if (input.logs) {
    add('log-coverage', '日志读取范围与缺失清单', { snapshotAt: iso(input.logs.snapshotAt), entries: input.logs.entries.length,
      hasMore: !!input.logs.nextCursor, scannedBytes: input.logs.scannedBytes, missingFiles: input.logs.missingFiles,
      skippedRecords: input.logs.skippedRecords, truncatedEntries: input.logs.truncatedEntries,
      fileLimitReached: input.logs.fileLimitReached, droppedEntries: input.logs.droppedEntries,
      storageError: !!input.logs.storageError });
    if (input.logs.missingFiles) warnings.push(`有 ${input.logs.missingFiles} 个日志文件缺失、不可读或不符合读取边界。`);
    if (!input.logs.entries.length) warnings.push('所选范围未找到日志；可能尚未产生日志或已被保留策略清理。');
    if (input.logs.nextCursor || input.logs.fileLimitReached) warnings.push('日志读取达到上限，仅导出预览中的第一页。');
    if (input.redact) {
      let lines = 0;
      for (const entry of input.logs.entries) {
        // Redact a complete record first so multi-line credentials cannot cross row boundaries.
        for (const message of input.redact(entry.message).split(/\r?\n/).filter(Boolean)) {
          if (++lines <= 200) add(`log-${lines}`, `日志 ${lines}`, {
            timestamp: iso(entry.timestamp), stream: entry.stream, service: serviceIds.get(entry.serviceSessionId) ?? 'OTHER_SERVICE', message,
          });
        }
      }
      if (lines > 200) warnings.push('日志超过 200 行，仅保留预览中的前 200 行。');
    } else warnings.push('无法建立完整的已知秘密替换表，已排除全部日志正文。');
  } else warnings.push('日志读取失败或超时，日志正文和文件缺失数量未知。');
  if (Buffer.byteLength(serializeBundle(entries, warnings), 'utf8') > DIAGNOSTIC_BUNDLE_MAX_BYTES) warnings.push('诊断包达到 1 MiB 上限，已省略末尾日志。');
  while (Buffer.byteLength(serializeBundle(entries, warnings), 'utf8') > DIAGNOSTIC_BUNDLE_MAX_BYTES && entries.at(-1)?.id.startsWith('log-')) {
    entries.pop();
  }
  const bytes = Buffer.byteLength(serializeBundle(entries, warnings), 'utf8');
  if (bytes > DIAGNOSTIC_BUNDLE_MAX_BYTES) throw new Error('诊断包超过 1 MiB，请缩小范围。');
  return { entries, warnings, bytes };
}

export function serializeBundle(entries: DiagnosticBundleEntry[], warnings: string[], excludedIds: string[] = []) {
  return JSON.stringify({ format: 'codehelm.diagnostic-bundle', version: 1,
    manifest: { includedIds: entries.map(entry => entry.id), excludedIds, warnings }, entries }, null, 2);
}
