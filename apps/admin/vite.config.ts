import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { reliableDevWatch } from '../../tooling/dev-watch.ts';

/**
 * tokens.css pide las fuentes en /fonts/*.woff2 (fuera de /admin/). En producción las sirve Caddy desde el
 * sitio público; en desarrollo las servimos desde apps/web/public/fonts para que el admin se vea con
 * Gloock, Pagella y Hanken Grotesk también acá. Solo nombres simples *.woff2: nada de rutas arbitrarias.
 */
function devFonts(): Plugin {
  const fontsDir = fileURLToPath(new URL('../web/public/fonts/', import.meta.url));
  return {
    name: 'blog-admin-dev-fonts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        if (!/^[\w.-]+\.woff2$/.test(name)) return next();
        const file = join(fontsDir, name);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'font/woff2');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** Servidor de desarrollo del sitio público (`astro dev`). En producción el sitio comparte dominio con el admin. */
const DEV_SITE_URL = 'http://localhost:4321/';

// El admin se sirve bajo /admin/ (Caddy) y habla con la API en /api (mismo origen: sin CORS).
export default defineConfig(({ command }) => ({
  base: '/admin/',
  // Solo en `vite dev`: los enlaces al sitio apuntan al servidor de Astro (src/siteUrl.ts). En el build queda "/".
  define: command === 'serve' ? { 'import.meta.env.VITE_SITE_URL': JSON.stringify(DEV_SITE_URL) } : {},
  plugins: [react(), devFonts()],
  server: {
    port: 5173,
    // Si el puerto está ocupado (por ejemplo un servidor anterior que no terminó de cerrarse), fallar con un error
    // claro en vez de mudarse en silencio a otro puerto: el navegador y el proxy esperan el 5173.
    strictPort: true,
    watch: reliableDevWatch,
    // En desarrollo, Vite reenvía /api a la API .NET local.
    proxy: { '/api': 'http://localhost:5090', '/media': 'http://localhost:5090' },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}));
