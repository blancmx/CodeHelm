import { describe, it, expect } from 'vitest';
import { normalizePath, isSubPath, safeResolvePath } from '../path.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  it('should reject an existing directory link that resolves outside the base', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-path-'));
    const base = path.join(tempRoot, 'project');
    const outside = path.join(tempRoot, 'outside');
    fs.mkdirSync(base);
    fs.mkdirSync(outside);

    try {
      fs.symlinkSync(
        outside,
        path.join(base, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      expect(() => safeResolvePath(base, 'linked')).toThrow(/outside base directory/i);
      expect(() => safeResolvePath(base, 'linked/missing/file.txt')).toThrow(/outside base directory/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
