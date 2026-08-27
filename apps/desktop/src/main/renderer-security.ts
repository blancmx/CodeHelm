import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedRenderer =
  | { kind: 'dev'; origin: string }
  | { kind: 'file'; path: string };

export interface TrustedDevRenderer {
  url: string;
  renderer: TrustedRenderer;
}

function normalizedFilePath(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '')
    .match(/^(?:localhost|127\.0\.0\.1|::1)$/) !== null;
}

export function createTrustedDevRenderer(rawUrl: string | undefined): TrustedDevRenderer | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || !isLoopbackHostname(parsed.hostname)
    ) {
      return null;
    }
    return {
      url: parsed.toString(),
      renderer: { kind: 'dev', origin: parsed.origin },
    };
  } catch {
    return null;
  }
}

export function createTrustedFileRenderer(filePath: string): TrustedRenderer {
  return { kind: 'file', path: normalizedFilePath(filePath) };
}

export function isTrustedRendererUrl(
  rawUrl: string,
  trustedRenderer: TrustedRenderer | null
): boolean {
  if (!trustedRenderer) return false;
  try {
    const parsed = new URL(rawUrl);
    if (trustedRenderer.kind === 'dev') {
      return !parsed.username
        && !parsed.password
        && ['http:', 'https:'].includes(parsed.protocol)
        && parsed.origin === trustedRenderer.origin;
    }
    if (parsed.protocol !== 'file:') return false;
    return normalizedFilePath(fileURLToPath(parsed)) === trustedRenderer.path;
  } catch {
    return false;
  }
}

export function isExternalHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
