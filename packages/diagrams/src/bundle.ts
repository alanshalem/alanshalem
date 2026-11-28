import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { MERMAID_SCRIPT_URL, MERMAID_VERSION } from './index.ts';

/**
 * The self-hosted Mermaid bundle of the site (Node only: the site build and its dev server). Mermaid's own ESM build,
 * minified, as published in npm: the entry `mermaid.esm.min.mjs` and its chunks, which load only the code of the
 * diagram types a page uses. Copied as is from node_modules into the release (no CDN, no build step), without the
 * source maps.
 */

const require = createRequire(import.meta.url);

/** `dist/` of the installed Mermaid. */
export const MERMAID_DIST = join(dirname(require.resolve('mermaid/package.json')), 'dist');

/** The installed Mermaid version (it must be `MERMAID_VERSION`: a test checks it). */
export const installedMermaidVersion = (): string =>
  (JSON.parse(readFileSync(join(dirname(MERMAID_DIST), 'package.json'), 'utf8')) as { version: string }).version;

const ENTRY = 'mermaid.esm.min.mjs';
const CHUNKS = 'chunks/mermaid.esm.min';

/** The site path the bundle is served from (`/scripts/mermaid-<version>/`), from `MERMAID_SCRIPT_URL`. */
export const MERMAID_BUNDLE_PATH = MERMAID_SCRIPT_URL.slice(0, MERMAID_SCRIPT_URL.length - ENTRY.length);

/** The bundle's files, relative to `dist/` and to `MERMAID_BUNDLE_PATH`: the entry and every chunk (.mjs only). */
export function mermaidBundleFiles(): string[] {
  const chunks = readdirSync(join(MERMAID_DIST, CHUNKS)).filter((name) => name.endsWith('.mjs')).sort();
  return [ENTRY, ...chunks.map((name) => `${CHUNKS}/${name}`)];
}

/** Copies the bundle into `siteDir` (a release folder) under `MERMAID_BUNDLE_PATH`; returns how many files. */
export function copyMermaidBundle(siteDir: string): number {
  if (installedMermaidVersion() !== MERMAID_VERSION) {
    throw new Error(`Mermaid ${installedMermaidVersion()} is installed, but the site serves ${MERMAID_VERSION}.`);
  }
  const target = join(siteDir, MERMAID_BUNDLE_PATH);
  const files = mermaidBundleFiles();
  for (const file of files) {
    mkdirSync(dirname(join(target, file)), { recursive: true });
    cpSync(join(MERMAID_DIST, file), join(target, file));
  }
  return files.length;
}

/**
 * The file of the bundle a request path asks for (`/scripts/mermaid-12.4.0/chunks/…/x.mjs` → its path in node_modules),
 * or null: for the dev server, which serves only the bundle's own files.
 */
export function mermaidBundleFile(path: string): string | null {
  if (!path.startsWith(MERMAID_BUNDLE_PATH)) return null;
  const file = path.slice(MERMAID_BUNDLE_PATH.length);
  if (!mermaidBundleFiles().includes(file)) return null;
  const full = join(MERMAID_DIST, file);
  return existsSync(full) ? full : null;
}
