/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { posePwa } from './shared/pwa-build.mjs';
export default defineConfig(({ mode }) => ({
  publicDir: mode === 'pwa' ? false : 'public',
  plugins: [
    ...(mode === 'pwa' ? [posePwa()] : []),
    react(),
    {
      name: 'production-csp',
      apply: 'build',
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
