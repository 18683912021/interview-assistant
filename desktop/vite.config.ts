import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_HOST = process.env.VITE_API_HOST || '47.108.205.102';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${API_HOST}:8010`,
        changeOrigin: true,
      },
      '/api/ws': {
        target: `ws://${API_HOST}:8010`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
