import path from 'node:path';

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

  return normalizedResolved;
}
