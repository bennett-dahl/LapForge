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
      '/static': 'http://127.0.0.1:5000',
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../LapForge/static/spa'),
    emptyOutDir: true,
  },
});
