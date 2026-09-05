import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import UnoCSS from 'unocss/vite';
import path from 'node:path';
import { rendererCspPlugin } from './src/main/renderer-csp';

export default defineConfig({
  base: './',
  plugins: [
    rendererCspPlugin(),
    vue(),
    UnoCSS(),
    electron([
      {
        entry: {
          index: 'src/main/index.ts',
          'analysis-worker': 'src/main/analysis-worker.ts',
          'analysis-boundary-worker': 'src/main/analysis-boundary-worker.ts',
          'workspace-worker': 'src/main/workspace-worker.ts',
        },
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            emptyOutDir: true,
            rollupOptions: {
              external: ['better-sqlite3', '@codehelm/safe-fs'],
              output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            emptyOutDir: true,
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
            },
          },
        },
      },
      {
        entry: 'src/preload/execution-confirmation.ts',
        onstart(options) { options.reload(); },
        vite: {
          build: {
            outDir: 'dist-electron/review-preload',
            emptyOutDir: true,
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'execution-confirmation.cjs', inlineDynamicImports: true },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    // Keep the desktop shell away from the conventional Vite application port.
    // Imported projects often hard-code http://localhost:5173 in CORS rules.
    port: 15173,
  },
});
