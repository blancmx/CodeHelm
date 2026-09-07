import { describe, expect, it } from 'vitest';
import { failureGuidance } from '../failure-guidance.js';

describe('fixed failure guidance', () => {
  it('preserves distinct advice without repeating private error payloads', () => {
    expect(failureGuidance({ status: 'FAILED', errorMessage: 'ENOENT secret-path' })).toContain('缺失');
    expect(failureGuidance({ status: 'FAILED', errorMessage: 'EADDRINUSE secret-port' })).toContain('端口');
    expect(failureGuidance({ status: 'DEGRADED', errorMessage: '就绪 timeout secret' })).toContain('健康检查');
    expect(failureGuidance({ status: 'FAILED', exitCode: 7 })).toContain('退出码');
    expect(failureGuidance({ status: 'ORPHANED' })).toContain('归属');
    expect(failureGuidance({ status: 'FAILED', errorMessage: 'SECRET_VALUE' })).not.toContain('SECRET_VALUE');
    expect(failureGuidance({ status: 'RUNNING' })).toBeNull();
  });
});
