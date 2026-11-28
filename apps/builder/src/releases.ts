import { mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Atomic deploy by symlink:
 *
 *   site/
 *     releases/20261125T120000000Z/   <- each build writes into its own folder
 *     releases/20261125T130000000Z/
 *     current -> releases/20261125T130000000Z   <- Caddy serves this
 *
 * Swapping `current` is a single rename(): the server sees the whole old version or the whole new one, never a mix or
 * a half-written folder. And rolling back is pointing the symlink at the previous version.
 *
 *     stamps/20261125T130000000Z     <- the builder version that built that release (see startup.ts)
 *
 * Stamps live next to the releases, not inside them: Caddy serves the release folder as it is.
 */

const RELEASES = 'releases';
const CURRENT = 'current';
const STAMPS = 'stamps';

export const releasesDir = (siteDir: string): string => join(siteDir, RELEASES);
export const currentLink = (siteDir: string): string => join(siteDir, CURRENT);
const stampFile = (siteDir: string, release: string): string => join(siteDir, STAMPS, basename(release));

/** Records which builder version built a release (`release`: its folder or its name). */
export async function writeReleaseStamp(siteDir: string, release: string, version: string): Promise<void> {
  await mkdir(join(siteDir, STAMPS), { recursive: true });
  await writeFile(stampFile(siteDir, release), `${version}\n`);
}

/** Deletes a release's stamp (a build that failed after stamping, a pruned release). Missing = nothing to do. */
export async function removeReleaseStamp(siteDir: string, release: string): Promise<void> {
  await rm(stampFile(siteDir, release), { force: true });
}

/** The builder version that built a release, or undefined if it has no stamp (built before stamps existed). */
export async function readReleaseStamp(siteDir: string, release: string): Promise<string | undefined> {
  try {
    return (await readFile(stampFile(siteDir, release), 'utf8')).trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Creates a new folder for a version. The name (UTC timestamp) sorts chronologically. */
export async function createReleaseDir(siteDir: string, now: Date = new Date()): Promise<string> {
  const id = now.toISOString().replace(/[-:.]/g, ''); // 2026-11-25T12:00:00.000Z -> 20261125T120000000Z
  const dir = join(releasesDir(siteDir), id);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Points `current` at the given version, atomically. */
export async function activateRelease(siteDir: string, releaseDir: string): Promise<void> {
  const target = join(RELEASES, basename(releaseDir));
  const temporary = join(siteDir, `.${CURRENT}-${process.pid}-${Date.now()}`);

  // RELATIVE target: Caddy and the builder mount the same volume at different paths (/srv/site vs /site);
  // an absolute target would point at a path that does not exist in Caddy.
  await symlink(target, temporary, 'dir');
  try {
    await rename(temporary, currentLink(siteDir)); // atomic: replaces the previous symlink in one go
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Name of the active version, or undefined when there is none yet. */
export async function activeReleaseName(siteDir: string): Promise<string | undefined> {
  try {
    return basename(await readlink(currentLink(siteDir)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Deletes the old versions. Keeps the `keep` newest ones and ALWAYS the active one (even when it is older). */
export async function pruneReleases(siteDir: string, keep: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(releasesDir(siteDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const active = await activeReleaseName(siteDir);
  const newestFirst = names.sort().reverse();
  const keepSet = new Set(newestFirst.slice(0, keep));
  if (active) keepSet.add(active);

  const removed = newestFirst.filter((name) => !keepSet.has(name));
  for (const name of removed) {
    await rm(join(releasesDir(siteDir), name), { recursive: true, force: true });
    await removeReleaseStamp(siteDir, name);
  }
  return removed;
}
