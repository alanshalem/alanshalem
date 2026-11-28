import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Which version of the builder (its site code: pages, styles, fonts, renderer) built a release. A release built by
 * another version is rebuilt on startup (startup.ts), so a new image reaches the published site without waiting for a
 * content save.
 */

/** Dependencies, caches and build output: not site sources (and node_modules is huge). */
const IGNORED_DIRS = new Set(['node_modules', '.astro', 'dist', '.git']);

/**
 * What a build is made of in the image (/app): the site, the workspace packages it renders with, the lockfile (the
 * exact dependency versions) and the builder's own code (precompression). Paths that do not exist are skipped.
 */
export function defaultVersionSources(webDir: string): string[] {
  const root = join(webDir, '..', '..');
  return [webDir, join(root, 'packages'), join(root, 'pnpm-lock.yaml'), fileURLToPath(new URL('.', import.meta.url))];
}

async function filesOf(path: string): Promise<string[]> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    // Symlinks are skipped: pnpm links packages into each other, and following them would hash dependencies.
    if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRS.has(entry.name))) continue;
    if (entry.isDirectory() || entry.isFile()) files.push(...(await filesOf(join(path, entry.name))));
  }
  return files;
}

/**
 * SHA-256 over every file under `sources` (sorted relative paths and their bytes), the first 16 hex digits. The same
 * files give the same hash on any machine; renaming, adding or changing any file changes it.
 */
export async function sourceHash(sources: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const [index, source] of sources.entries()) {
    const files = (await filesOf(source)).map((file) => ({ file, name: relative(source, file).split(sep).join('/') }));
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const { file, name } of files) {
      const content = await readFile(file);
      hash.update(`${index}\0${name}\0${content.length}\0`);
      hash.update(content);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * `BUILDER_VERSION` when the image sets it (its revision), otherwise `sources-<hash>` of the site sources: an image
 * whose sources did not change keeps its version, so an unrelated release (an API-only fix) does not rebuild the site.
 */
export async function resolveBuilderVersion(env: NodeJS.ProcessEnv, sources: readonly string[]): Promise<string> {
  const fromImage = env.BUILDER_VERSION?.trim();
  if (fromImage) return fromImage;
  return `sources-${await sourceHash(sources)}`;
}
