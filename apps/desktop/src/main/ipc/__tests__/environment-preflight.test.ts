import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunProfile } from '@codehelm/domain';
import { ENVIRONMENT_PREFLIGHT_ERROR } from '@codehelm/contracts';

const diagnose = vi.hoisted(() => vi.fn());
vi.mock('../profile-diagnostics.js', () => ({ diagnoseProfile: diagnose }));
import { assertEnvironmentReady } from '../environment-preflight.js';

const profile = { id: 'profile' } as RunProfile;
const signal = new AbortController().signal;
beforeEach(() => { diagnose.mockReset(); });

describe('fresh environment preflight', () => {
  it('permits warnings and unknown version/dependency completeness', async () => {
    diagnose.mockResolvedValue({ checks: [
      { code: 'RUNTIME_VERSION_UNCHECKED', status: 'unknown' },
      { code: 'DEPENDENCY_HINTS', status: 'unknown' },
      { code: 'PORT_UNAVAILABLE', status: 'warning' },
    ] });
    await expect(assertEnvironmentReady('/project', profile, 'start', signal)).resolves.toBeUndefined();
    await assertEnvironmentReady('/project', profile, 'start', signal);
    expect(diagnose).toHaveBeenCalledTimes(2);
  });

  it.each(['ROOT_MISSING', 'CWD_OUTSIDE_PROJECT', 'NO_ENABLED_SERVICES', 'SERVICE_GRAPH', 'COMMAND_NOT_FOUND'])('blocks %s without exposing raw service names or errors', async code => {
    diagnose.mockResolvedValue({ checks: [{ code, status: 'blocked', title: '工作目录', serviceName: 'SECRET', detail: 'SECRET' }] });
    const attempt = assertEnvironmentReady('/project', profile, 'start', signal);
    await expect(attempt).rejects.toThrow(ENVIRONMENT_PREFLIGHT_ERROR);
    await expect(attempt).rejects.not.toThrow('SECRET');
  });

  it.each(['ROOT_UNREADABLE', 'CWD_UNREADABLE', 'COMMAND_UNKNOWN'])('does not mistake incomplete %s for a usable environment', async code => {
    diagnose.mockResolvedValue({ checks: [{ code, status: 'unknown', title: '无法检查' }] });
    await expect(assertEnvironmentReady('/project', profile, 'start', signal)).rejects.toThrow(ENVIRONMENT_PREFLIGHT_ERROR);
  });

  it('allows installation to create a runtime, but rechecks and blocks if it is still missing', async () => {
    diagnose.mockResolvedValue({ checks: [{ code: 'COMMAND_NOT_FOUND', status: 'blocked', title: '启动命令文件' }] });
    await expect(assertEnvironmentReady('/project', profile, 'before_install', signal)).resolves.toBeUndefined();
    await expect(assertEnvironmentReady('/project', profile, 'start', signal)).rejects.toThrow(ENVIRONMENT_PREFLIGHT_ERROR);
  });

  it('does not relax invalid working directories before installation', async () => {
    diagnose.mockResolvedValue({ checks: [{ code: 'CWD_MISSING', status: 'blocked', title: '工作目录' }] });
    await expect(assertEnvironmentReady('/project', profile, 'before_install', signal)).rejects.toThrow(ENVIRONMENT_PREFLIGHT_ERROR);
  });

  it('fails closed on timeout without forwarding raw data', async () => {
    diagnose.mockRejectedValue(new Error('SECRET timeout path'));
    const attempt = assertEnvironmentReady('/project', profile, 'start', signal);
    await expect(attempt).rejects.toThrow('环境检查未完成');
    await expect(attempt).rejects.not.toThrow('SECRET');
  });

  it('propagates cancellation without starting a check', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(assertEnvironmentReady('/project', profile, 'start', controller.signal)).rejects.toThrow('cancelled');
    expect(diagnose).not.toHaveBeenCalled();
  });
});
