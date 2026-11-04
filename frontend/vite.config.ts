import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import packageJson from './package.json' with { type: 'json' };

// The backend's default CORS origin is http://localhost:5173, so dev and preview
// both use exactly that origin. Opening the app on 127.0.0.1 would be blocked by CORS.
const origin = { host: 'localhost', port: 5173, strictPort: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: origin,
  preview: origin,
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
