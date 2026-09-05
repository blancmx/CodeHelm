import type { Plugin } from 'vite';

// Renderer data access uses the preload bridge. Only Vite's development client
// needs a socket; never carry that permission into a built file:// renderer.
export function rendererCspPlugin(): Plugin {
  return {
    name: 'codehelm-renderer-csp',
    transformIndexHtml: {
      // Prepend after Vite has injected its client/module tags, so the policy
      // also covers those tags rather than appearing below the first script.
      order: 'post',
      handler(_html, context) {
        const connect = context.server
          ? "'self' ws://localhost:* ws://127.0.0.1:*"
          : "'none'";
        return [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: [
              "default-src 'self'",
              "script-src 'self'",
              // Vue/Naive UI/UnoCSS use dynamic styles, not dynamic scripts.
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "img-src 'self' data:",
              `connect-src ${connect}`,
              "object-src 'none'",
              "frame-src 'none'",
              "worker-src 'none'",
              "base-uri 'none'",
              "form-action 'none'",
            ].join('; '),
          },
          injectTo: 'head-prepend',
        }];
      },
    },
  };
}
