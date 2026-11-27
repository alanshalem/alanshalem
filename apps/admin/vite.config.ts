import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { reliableDevWatch } from '../../tooling/dev-watch.ts';

/**
 * tokens.css requests the fonts at /fonts/*.woff2 (outside /admin/). In production Caddy serves them from the public
 * site; in development we serve them from apps/web/public/fonts so the admin also shows Gloock, Pagella and Hanken
 * Grotesk here. Only plain *.woff2 names: no arbitrary paths.
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

/**
 * Only for `vite dev`, with the same names the site uses (astro.config.mjs): API_URL, where /api and /media are
 * forwarded; SITE_URL, the `astro dev` server for the "Ver sitio" links (in production the site shares the admin's
 * domain). Without variables, the usual local servers; Docker (compose.dev.yml) points them at its services.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:5090';
const DEV_SITE_URL = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/?$/, '/');

// The admin is served under /admin/ (Caddy) and talks to the API at /api (same origin: no CORS).
export default defineConfig(({ command }) => ({
  base: '/admin/',
  // Only in `vite dev`: links to the site point at the Astro server (src/siteUrl.ts). The build keeps "/".
  define: command === 'serve' ? { 'import.meta.env.VITE_SITE_URL': JSON.stringify(DEV_SITE_URL) } : {},
  plugins: [react(), devFonts()],
  server: {
    port: 5173,
    // If the port is busy (for example a previous server that has not finished closing), fail with a clear error
    // instead of silently moving to another port: the browser and the proxy expect 5173.
    strictPort: true,
    watch: reliableDevWatch,
    // In development, Vite forwards /api and /media to the .NET API.
    proxy: { '/api': API_URL, '/media': API_URL },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}));
