import path from 'node:path';
import fs from 'node:fs';

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * Resolves the existing portion of a path physically, then appends any
 * missing tail. This catches both existing symlinks and symlinked ancestors
 * while still allowing callers to validate paths that have not been created
 * yet.
 */
function resolvePhysicalPath(inputPath: string): string | undefined {
  let current = path.resolve(inputPath);
  const missingTail: string[] = [];

  while (true) {
    try {
      const physicalCurrent = fs.realpathSync.native(current);
      return path.resolve(physicalCurrent, ...missingTail.reverse());
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;

      const parent = path.dirname(current);
      if (parent === current) return undefined;
      missingTail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Normalizes a path to forward slashes and resolves relative segments.
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) return '';
  const resolved = path.resolve(inputPath);
  return resolved.replace(/\\/g, '/');
}

/**
 * Checks if targetPath is strictly inside or equal to basePath (prevents path traversal).
 */
export function isSubPath(basePath: string, targetPath: string): boolean {
  const normBase = normalizePath(basePath).toLowerCase();
  const normTarget = normalizePath(targetPath).toLowerCase();

  if (normBase === normTarget) return true;
  return normTarget.startsWith(normBase.endsWith('/') ? normBase : normBase + '/');
}

/**
 * Safely resolves a subpath relative to a base directory, throwing if it escapes.
 */
export function safeResolvePath(basePath: string, relativePath: string): string {
  const resolved = path.resolve(basePath, relativePath);
  const normalizedResolved = normalizePath(resolved);
  const normalizedBase = normalizePath(basePath);

  if (!isSubPath(normalizedBase, normalizedResolved)) {
    throw new Error(`Path security violation: '${relativePath}' escapes base directory '${basePath}'`);
  }

  const physicalBase = resolvePhysicalPath(basePath);
  const physicalResolved = resolvePhysicalPath(resolved);
  if (
    physicalBase
    && physicalResolved
    && !isSubPath(physicalBase, physicalResolved)
  ) {
    throw new Error(`Path security violation: '${relativePath}' resolves outside base directory '${basePath}'`);
  }

  return normalizedResolved;
}
