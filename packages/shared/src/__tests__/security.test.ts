import { describe, it, expect } from 'vitest';
import { maskSecretValue, sanitizeEnvVars } from '../security.js';

describe('Security Masking & Sanitization', () => {
  it('should mask sensitive strings of various lengths', () => {
    expect(maskSecretValue('abc')).toBe('••••');
    expect(maskSecretValue('12345678')).toBe('1••••8');
    expect(maskSecretValue('sk_test_1234567890abcdef')).toBe('sk••••••••ef');
    expect(maskSecretValue('')).toBe('');
  });

  it('should sanitize arrays of environment variables', () => {
    const rawVars = [
      { key: 'PORT', value: '3000', isSecret: false },
      { key: 'DB_PASSWORD', value: 'my_super_secret_password', isSecret: true },
    ];

    const sanitized = sanitizeEnvVars(rawVars);
    expect(sanitized[0].value).toBe('3000');
    expect(sanitized[1].value).not.toBe('my_super_secret_password');
    expect(sanitized[1].value).toContain('••••');
  });
});
