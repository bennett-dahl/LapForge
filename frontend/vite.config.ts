import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/auth': 'http://127.0.0.1:5000',
      '/upload': 'http://127.0.0.1:5000',
      '/static': {
        target: 'http://127.0.0.1:5000',
        bypass(req) {
          if (req.url?.startsWith('/static/spa/')) return req.url;
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../LapForge/static/spa'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  base: '/static/spa/',
});
