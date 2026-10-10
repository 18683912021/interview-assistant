import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiHost = env.VITE_API_HOST || '127.0.0.1';
  const target = env.VITE_API_BASE || `http://${apiHost}:8010`;
  const projectRoot = path.resolve(__dirname);
  const startedAt = Date.now();
  return {
    plugins: [
      react(),
      {
        name: 'desktop-dev-readiness',
        configureServer(server) {
          server.middlewares.use('/__desktop_dev_ready__', (_request, response) => {
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(JSON.stringify({app: 'interview-desktop', root: projectRoot, startedAt}));
          });
        },
      },
    ],
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
      // Electron and the readiness check must use the same loopback address.
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/ws': {target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: true},
        '/api': {target, changeOrigin: true},
      },
    },
  };
});
