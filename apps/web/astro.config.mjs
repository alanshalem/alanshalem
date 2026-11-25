// @ts-check
import { defineConfig } from 'astro/config';

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
});
