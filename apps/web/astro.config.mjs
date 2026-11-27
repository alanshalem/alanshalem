// @ts-check
import { defineConfig } from 'astro/config';

import { reliableDevWatch } from '../../tooling/dev-watch.ts';
import { SITE_CSP } from './src/lib/csp.ts';

const siteUrl = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');

export default defineConfig({
  // 100% static: zero server JavaScript in production, Caddy serves files.
  output: 'static',
  site: siteUrl,

  // /articulos/mi-post/index.html  ->  URL /articulos/mi-post/
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // All the CSS goes inside the HTML: one request less before painting (better LCP).
    // The site is small; if it grows a lot, go back to 'auto'.
    inlineStylesheets: 'always',
  },
  compressHTML: true,

  // The builder builds each version in its own folder and then switches the `current` symlink.
  outDir: process.env.OUT_DIR ?? './dist',

  devToolbar: { enabled: false },

  // CSP in a <meta> on every page, with the hashes of the inline scripts and styles (src/lib/csp.ts).
  // Astro does not apply it in `astro dev`: test it with a build.
  security: { csp: SITE_CSP },
  // @blog/markdown renders the posts, not Astro: no Shiki (its inline styles would clash with the CSP).
  markdown: { syntaxHighlight: false },

  vite: {
    server: {
      watch: reliableDevWatch,
      // Only `astro dev`: in production Caddy serves /media from disk; here the API serves it (in Development).
      proxy: { '/media': process.env.API_URL ?? 'http://localhost:5090' },
    },
  },
});
