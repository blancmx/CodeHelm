import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createTrustedDevRenderer,
  createTrustedFileRenderer,
  isExternalHttpUrl,
  isTrustedRendererUrl,
} from '../renderer-security.js';

describe('renderer URL security', () => {
  it('accepts only the exact loopback dev origin', () => {
    const trusted = createTrustedDevRenderer('http://localhost:15173/');
    expect(trusted).not.toBeNull();
    expect(isTrustedRendererUrl('http://localhost:15173/projects/1', trusted?.renderer ?? null)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost.evil.test:15173/', trusted?.renderer ?? null)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:15174/', trusted?.renderer ?? null)).toBe(false);
    expect(isTrustedRendererUrl('https://localhost:15173/', trusted?.renderer ?? null)).toBe(false);
  });

  it('rejects non-loopback dev URLs and credentials', () => {
    expect(createTrustedDevRenderer('https://example.test/')).toBeNull();
    expect(createTrustedDevRenderer('http://user:pass@localhost:15173/')).toBeNull();
    expect(createTrustedDevRenderer('file:///tmp/index.html')).toBeNull();
  });

  it('accepts only the exact packaged renderer file', () => {
    const rendererPath = path.resolve('dist/index.html');
    const trusted = createTrustedFileRenderer(rendererPath);
    const rendererUrl = pathToFileURL(rendererPath).toString();

    expect(isTrustedRendererUrl(`${rendererUrl}#/overview`, trusted)).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL(path.resolve('dist/other.html')).toString(), trusted)).toBe(false);
    expect(isTrustedRendererUrl('file:///C:/Users/Public/index.html', trusted)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:15173/', trusted)).toBe(false);
  });

  it('only classifies valid HTTP(S) URLs as external browser targets', () => {
    expect(isExternalHttpUrl('https://example.test/docs')).toBe(true);
    expect(isExternalHttpUrl('http://example.test')).toBe(true);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl('file:///tmp/secret.txt')).toBe(false);
  });
});
