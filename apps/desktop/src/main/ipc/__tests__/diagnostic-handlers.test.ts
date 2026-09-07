import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import type { RegisterIpcHandler } from '../trusted-ipc.js';

const harness = vi.hoisted(() => ({
  findProfile: vi.fn(), findProject: vi.fn(), diagnose: vi.fn(), decrypt: vi.fn(),
}));
vi.mock('@codehelm/database', () => ({
  ProfileRepository: class { findById = harness.findProfile; },
  ProjectRepository: class { findById = harness.findProject; },
}));
vi.mock('../profile-diagnostics.js', () => ({ diagnoseProfile: harness.diagnose }));
vi.mock('../profile-secrets.js', () => ({ decryptProfileSecrets: harness.decrypt }));
import { registerDiagnosticHandlers } from '../diagnostic-handlers.js';

const id = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
let invoke: (input: unknown) => Promise<unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  harness.findProfile.mockReturnValue({ id, projectId, services: [] });
  harness.findProject.mockReturnValue({ id: projectId, rootPath: '/trusted/project' });
  harness.decrypt.mockImplementation(value => value);
  harness.diagnose.mockResolvedValue({ profileId: id, projectId, checkedAt: '2026-09-06T00:00:00.000Z', expiresAt: '2026-09-06T00:01:00.000Z', fingerprint: 'opaque', checks: [] });
  registerDiagnosticHandlers(((channel, handler) => {
    expect(channel).toBe(IpcChannels.RUNNER_DIAGNOSE);
    invoke = input => handler({} as Electron.IpcMainInvokeEvent, input);
  }) as RegisterIpcHandler, {} as Database);
});

describe('diagnostic IPC', () => {
  it('accepts only a stored profile id, never a renderer-controlled path or command', async () => {
    await expect(invoke({ profileId: id, rootPath: '/outside', executable: 'evil' })).rejects.toThrow('诊断请求无效');
    await expect(invoke({ profileId: 'not-a-uuid' })).rejects.toThrow('诊断请求无效');
    expect(harness.diagnose).not.toHaveBeenCalled();
    await expect(invoke({ profileId: id })).resolves.toMatchObject({ profileId: id });
    expect(harness.diagnose).toHaveBeenCalledWith('/trusted/project', { id, projectId, services: [] });
  });

  it('rejects missing profiles or projects before diagnostics', async () => {
    harness.findProfile.mockReturnValueOnce(null);
    await expect(invoke({ profileId: id })).rejects.toThrow('启动方案不存在');
    harness.findProject.mockReturnValueOnce(null);
    await expect(invoke({ profileId: id })).rejects.toThrow('项目不存在');
    expect(harness.diagnose).not.toHaveBeenCalled();
  });

  it('does not expose raw decryption or filesystem errors', async () => {
    harness.decrypt.mockImplementationOnce(() => { throw new Error('SECRET_RAW'); });
    await expect(invoke({ profileId: id })).rejects.toThrow('环境检查未完成');
    harness.diagnose.mockRejectedValueOnce(new Error('SECRET_RAW'));
    await expect(invoke({ profileId: id })).rejects.toThrow('环境检查未完成');
  });

  it('discards a result if the saved configuration changes during the check', async () => {
    harness.findProfile.mockReturnValueOnce({ id, projectId, services: [] }).mockReturnValueOnce({ id, projectId, services: [], name: 'changed' });
    await expect(invoke({ profileId: id })).rejects.toThrow('方案已变化');
  });
});
