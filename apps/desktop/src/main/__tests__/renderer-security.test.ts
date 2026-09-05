import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import { rendererCspPlugin } from '../renderer-csp.js';
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

describe('renderer CSP HTML delivery', () => {
  const html = '<html><head><script src="/entry.js"></script></head><body></body></html>';

  it('injects the development policy before scripts without permitting inline script or eval', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codehelm-csp-'));
    const server = await createServer({
      root, configFile: false, plugins: [rendererCspPlugin()],
      server: { middlewareMode: true, watch: null, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const output = (await server.transformIndexHtml('/', html)).replaceAll('&#39;', "'");
      expect(output.indexOf('Content-Security-Policy')).toBeLessThan(output.indexOf('<script'));
      expect(output).toContain("script-src 'self';");
      expect(output).not.toContain('unsafe-eval');
      expect(output).toContain("connect-src 'self' ws://localhost:* ws://127.0.0.1:*");
    } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
  });

  it('emits the offline production policy when no dev server exists, regardless of mode', async () => {
    const hook = rendererCspPlugin().transformIndexHtml;
    if (!hook || typeof hook === 'function' || !('handler' in hook)) throw new Error('Expected ordered HTML transform');
    const tags = await hook.handler(html, { path: '/index.html', filename: 'index.html' });
    expect(tags).toEqual([expect.objectContaining({
      injectTo: 'head-prepend',
      attrs: expect.objectContaining({ content: expect.stringContaining("connect-src 'none'") }),
    })]);
    expect(JSON.stringify(tags)).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|ws:|https:/);
  });
});
