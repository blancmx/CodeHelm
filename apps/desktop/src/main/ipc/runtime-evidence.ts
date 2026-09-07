import { createHmac, randomBytes } from 'node:crypto';
import type { RunProfile } from '@codehelm/domain';
import type { DiagnosticCheckDto, RuntimeProbeDto } from '@codehelm/contracts';
import { inspectRuntime } from './runtime-probe.js';
import { matchRuntimeToProfile } from './runtime-version-match.js';

const key = randomBytes(32);
const evidence = new Map<string, { signature: string; probe: RuntimeProbeDto }>();
const signature = (root: string, profile: RunProfile) => createHmac('sha256', key).update(JSON.stringify({ root, id: profile.id, services: profile.services, environment: process.env })).digest('hex');
export function rememberRuntimeEvidence(root: string, profile: RunProfile, probe: RuntimeProbeDto) {
  const id = `${profile.id}:${probe.family}`;
  evidence.delete(id);
  if (evidence.size >= 64) evidence.delete(evidence.keys().next().value!);
  evidence.set(id, { signature: signature(root, profile), probe: structuredClone(probe) });
}

/** Re-read file identity and project constraints, without executing a version command again. */
export async function recheckRuntimeEvidence(root: string, profile: RunProfile, signal?: AbortSignal): Promise<DiagnosticCheckDto[]> {
  const checks: DiagnosticCheckDto[] = [];
  for (const family of ['node', 'python', 'java']) {
    const saved = evidence.get(`${profile.id}:${family}`);
    if (!saved || saved.signature !== signature(root, profile)) continue;
    const affected = saved.probe.services.filter(item => item.commandMatch === 'matched');
    if (!affected.length) continue;
    try {
      if (Date.now() - Date.parse(saved.probe.checkedAt) >= 60_000) throw new Error('Expired');
      const current = await inspectRuntime(saved.probe.executablePath, saved.probe.family, root,
        signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000));
      if (current.sha256 !== saved.probe.sha256 || current.path !== saved.probe.executablePath) throw new Error('Changed runtime');
      const matches = await matchRuntimeToProfile(root, profile, saved.probe, signal);
      for (const match of matches.filter(item => item.commandMatch === 'matched')) {
        checks.push({ code: 'RUNTIME_VERSION_RECHECKED', serviceId: match.serviceId, serviceName: match.serviceName,
          title: '运行时版本', status: match.requirementStatus === 'unsatisfied' ? family === 'java' ? 'warning' : 'blocked' : match.requirementStatus === 'satisfied' ? 'passed' : 'unknown',
          detail: match.detail, suggestion: '已重新核对所选文件摘要和当前声明，未再次执行版本命令。Java 结果仅针对构建 JVM 声明。' });
      }
    } catch {
      signal?.throwIfAborted();
      for (const match of affected) checks.push({ code: 'RUNTIME_RECHECK_REQUIRED', serviceId: match.serviceId, serviceName: match.serviceName,
        title: '运行时版本', status: 'blocked', detail: '之前确认的版本证据已过期、文件变化或无法重新核对。', suggestion: '请重新选择并检查运行时版本；旧结果不能用于本次启动。' });
    }
  }
  return checks;
}
