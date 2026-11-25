import { mkdir, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Despliegue atómico por symlink:
 *
 *   site/
 *     releases/20261125T120000000Z/   <- cada build escribe en su propia carpeta
 *     releases/20261125T130000000Z/
 *     current -> releases/20261125T130000000Z   <- Caddy sirve esto
 *
 * Cambiar `current` es un único rename(): el servidor ve la versión vieja completa o la nueva completa,
 * nunca una mezcla ni una carpeta a medio escribir. Y volver atrás es apuntar el symlink a la versión anterior.
 */

const RELEASES = 'releases';
const CURRENT = 'current';

export const releasesDir = (siteDir: string): string => join(siteDir, RELEASES);
export const currentLink = (siteDir: string): string => join(siteDir, CURRENT);

/** Crea una carpeta nueva para una versión. El nombre (timestamp UTC) ordena cronológicamente. */
export async function createReleaseDir(siteDir: string, now: Date = new Date()): Promise<string> {
  const id = now.toISOString().replace(/[-:.]/g, ''); // 2026-11-25T12:00:00.000Z -> 20261125T120000000Z
  const dir = join(releasesDir(siteDir), id);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Apunta `current` a la versión dada, de forma atómica. */
export async function activateRelease(siteDir: string, releaseDir: string): Promise<void> {
  const target = join(RELEASES, basename(releaseDir));
  const temporary = join(siteDir, `.${CURRENT}-${process.pid}-${Date.now()}`);

  // Destino RELATIVO: Caddy y el builder montan el mismo volumen en rutas distintas (/srv/site vs /site);
  // un destino absoluto apuntaría a una ruta que en Caddy no existe.
  await symlink(target, temporary, 'dir');
  try {
    await rename(temporary, currentLink(siteDir)); // atómico: reemplaza el symlink anterior de una vez
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Nombre de la versión activa, o undefined si todavía no hay ninguna. */
export async function activeReleaseName(siteDir: string): Promise<string | undefined> {
  try {
    return basename(await readlink(currentLink(siteDir)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Borra las versiones viejas. Conserva las `keep` más nuevas y SIEMPRE la activa (aunque no sea de las nuevas). */
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
  }
  return removed;
}
