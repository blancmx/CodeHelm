import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import UnoCSS from 'unocss/vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    UnoCSS(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['better-sqlite3'],
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
