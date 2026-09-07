import { describe, expect, it, vi, afterEach } from 'vitest';
import type { RunProfile } from '@codehelm/domain';
import type { RuntimeProbeDto } from '@codehelm/contracts';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), match: vi.fn() }));
vi.mock('../runtime-probe.js', () => ({ inspectRuntime: mocks.inspect }));
vi.mock('../runtime-version-match.js', () => ({ matchRuntimeToProfile: mocks.match }));
import { rememberRuntimeEvidence, recheckRuntimeEvidence } from '../runtime-evidence.js';
afterEach(() => vi.restoreAllMocks());
describe('rechecking single-use version evidence', () => {
  it('rereads current constraints, rejects changed files and expires without invoking the runtime', async () => {
    const profile = { id: 'evidence-test', services: [] } as unknown as RunProfile;
    const probe: RuntimeProbeDto = { family: 'node', executablePath: '/node.exe', sha256: 'hash', version: '24.0.0', checkedAt: new Date().toISOString(), services: [{ serviceId: 's', serviceName: 'service', commandMatch: 'matched', requirementStatus: 'satisfied', detail: '' }] };
    rememberRuntimeEvidence('/root', profile, probe);
    mocks.inspect.mockResolvedValue({ path: '/node.exe', sha256: 'hash' });
    mocks.match.mockResolvedValue([{ ...probe.services[0], requirementStatus: 'unsatisfied', detail: 'Changed constraint' }]);
    expect(await recheckRuntimeEvidence('/root', profile)).toContainEqual(expect.objectContaining({ code: 'RUNTIME_VERSION_RECHECKED', status: 'blocked' }));
    expect(mocks.match).toHaveBeenCalledOnce();
    mocks.inspect.mockResolvedValue({ path: '/node.exe', sha256: 'changed' });
    expect(await recheckRuntimeEvidence('/root', profile)).toContainEqual(expect.objectContaining({ code: 'RUNTIME_RECHECK_REQUIRED', status: 'blocked' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(probe.checkedAt) + 60001);
    expect(await recheckRuntimeEvidence('/root', profile)).toContainEqual(expect.objectContaining({ code: 'RUNTIME_RECHECK_REQUIRED' }));
    expect(await recheckRuntimeEvidence('/other-root', profile)).toEqual([]);
  });
});
