/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { posePwa } from './shared/pwa-build.mjs';
export default defineConfig(({ mode }) => ({
  publicDir: mode === 'pwa' ? false : 'public',
  plugins: [
    ...(mode === 'pwa' ? [posePwa()] : []),
    react(),
    {
      name: 'production-csp',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD-PARTY-NOTICES.txt',
          source: readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8'),
        });
      },
      transformIndexHtml(html) {
        return html.replace(
          '<head>',
          '<head>' +
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' file: blob:; object-src 'none'; base-uri 'self'; form-action 'none'\"/>",
        );
      },
    },
  ],
  base: './',
  // The real-rig tests run several seconds under a full parallel run.
  test: { testTimeout: 20000 },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 950,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
}));
