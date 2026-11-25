import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// El admin se sirve bajo /admin/ (Caddy) y habla con la API en /api (mismo origen: sin CORS).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo, Vite reenvía /api a la API .NET local.
    proxy: { '/api': 'http://localhost:5090', '/media': 'http://localhost:5090' },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
