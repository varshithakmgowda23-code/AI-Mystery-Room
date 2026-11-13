import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:5050';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin /api in development: no CORS preflights and first-party cookies (DEC-008).
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
  };
});
