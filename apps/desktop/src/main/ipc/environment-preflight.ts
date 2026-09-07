import type { RunProfile } from '@codehelm/domain';
import { ENVIRONMENT_PREFLIGHT_ERROR } from '@codehelm/contracts';
import { diagnoseProfile } from './profile-diagnostics.js';

export type PreflightPhase = 'before_install' | 'start';

/** A fresh read-only check, never a cached renderer report or an execution authorization. */
export async function assertEnvironmentReady(rootPath: string, profile: RunProfile, phase: PreflightPhase, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let report;
  try { report = await diagnoseProfile(rootPath, profile, { signal }); }
  catch {
    signal.throwIfAborted();
    throw new Error(`${ENVIRONMENT_PREFLIGHT_ERROR}: 启动前环境检查未完成，请在项目详情的“环境诊断”中检查后重试。`);
  }
  signal.throwIfAborted();
  const blocking = report.checks.filter(check => {
    // Install may create a local interpreter or command. Recheck it after installation.
    if (phase === 'before_install' && ['COMMAND_NOT_FOUND', 'COMMAND_UNKNOWN', 'REFERENCE_FILE'].includes(check.code)) return false;
    // Unknown runtime/dependency completeness remains informational. Unreadable roots
    // and commands cannot safely be treated as successful preflight checks.
    return check.status === 'blocked' || ['ROOT_UNREADABLE', 'CWD_UNREADABLE', 'COMMAND_UNKNOWN'].includes(check.code);
  });
  if (blocking.length) {
    // Only include our own check titles, never raw config names, arguments, env or OS errors.
    const titles = [...new Set(blocking.map(check => check.title))].join('、');
    throw new Error(`${ENVIRONMENT_PREFLIGHT_ERROR}: 启动前检查发现 ${blocking.length} 项问题（${titles}），服务尚未启动。请前往“环境诊断”查看原因。`);
  }
}
