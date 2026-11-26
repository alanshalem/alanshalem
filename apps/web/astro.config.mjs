// @ts-check
import { defineConfig } from 'astro/config';

import { reliableDevWatch } from '../../tooling/dev-watch.ts';
import { SITE_CSP } from './src/lib/csp.ts';

const siteUrl = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');

export default defineConfig({
  // 100% estático: cero JavaScript de servidor en producción, Caddy sirve archivos.
  output: 'static',
  site: siteUrl,

  // /articulos/mi-post/index.html  ->  URL /articulos/mi-post/
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Todo el CSS va dentro del HTML: una petición menos antes de pintar (mejor LCP).
    // El sitio es chico; si crece mucho, volver a 'auto'.
    inlineStylesheets: 'always',
  },
  compressHTML: true,

  // El builder construye cada versión en su propia carpeta y después cambia el symlink `current`.
  outDir: process.env.OUT_DIR ?? './dist',

  devToolbar: { enabled: false },

  // CSP en un <meta> de cada página, con los hashes de los scripts y estilos en línea (src/lib/csp.ts).
  // Astro no la aplica en `astro dev`: se prueba con un build.
  security: { csp: SITE_CSP },
  // Los posts los renderiza @blog/markdown, no Astro: sin Shiki (sus estilos en línea chocarían con la CSP).
  markdown: { syntaxHighlight: false },

  vite: {
    server: {
      watch: reliableDevWatch,
      // Solo `astro dev`: en producción Caddy sirve /media desde el disco; acá lo sirve la API (en Development).
      proxy: { '/media': process.env.API_URL ?? 'http://localhost:5090' },
    },
  },
});
