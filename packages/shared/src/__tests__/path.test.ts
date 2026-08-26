import { describe, it, expect } from 'vitest';
import { normalizePath, isSubPath, safeResolvePath } from '../path.js';

describe('Path Security & Normalization', () => {
  it('should normalize Windows backslashes to forward slashes', () => {
    expect(normalizePath('C:\\projects\\my-app')).toBe('C:/projects/my-app');
  });

  it('should correctly detect valid subpaths', () => {
    expect(isSubPath('C:/projects/my-app', 'C:/projects/my-app/src')).toBe(true);
    expect(isSubPath('C:/projects/my-app', 'C:/projects/my-app')).toBe(true);
    expect(isSubPath('C:/projects/my-app', 'C:/projects/other-app')).toBe(false);
  });

  it('should prevent path traversal outside root directory', () => {
    expect(() => {
      safeResolvePath('C:/projects/my-app', '../other-dir');
    }).toThrow(/security violation/i);
  });

  it('should allow valid relative paths', () => {
    const resolved = safeResolvePath('C:/projects/my-app', 'src/components');
    expect(resolved).toBe('C:/projects/my-app/src/components');
  });
});
