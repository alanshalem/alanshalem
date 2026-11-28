// @ts-check
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { copyMermaidBundle, mermaidBundleFile } from '@blog/diagrams/bundle';
import { defineConfig } from 'astro/config';

import { reliableDevWatch } from '../../tooling/dev-watch.ts';
import { SITE_CSP } from './src/lib/csp.ts';

/**
 * The self-hosted Mermaid bundle (@blog/diagrams): copied from node_modules into each release under
 * /scripts/mermaid-<version>/ (never a CDN), and served from node_modules by `astro dev`. Only pages with a diagram
 * load it.
 * @returns {import('astro').AstroIntegration}
 */
function mermaidBundle() {
  return {
    name: 'blog-mermaid-bundle',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const file = mermaidBundleFile((req.url ?? '').split('?')[0] ?? '');
          if (!file) return next();
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(file).pipe(res);
        });
      },
      'astro:build:done': ({ dir, logger }) => {
        logger.info(`Mermaid bundle: ${copyMermaidBundle(fileURLToPath(dir))} files`);
      },
    },
  };
}

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

  integrations: [mermaidBundle()],

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
