import { spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuilderConfig } from './config.ts';
import { precompressSite } from './compress.ts';
import { activateRelease, createReleaseDir, pruneReleases } from './releases.ts';

export interface BuildResult {
  release: string;
  durationMs: number;
  compressedFiles: number;
}

/** Corre `astro build` con baja prioridad de CPU (nice) para no quitarle recursos a las otras apps del VPS. */
function runAstroBuild(config: BuilderConfig, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'pnpm', 'exec', 'astro', 'build'], {
      cwd: config.webDir,
      env: {
        ...process.env,
        OUT_DIR: outDir,
        API_URL: config.apiUrl,
        BUILDER_TOKEN: config.token,
        SITE_URL: config.siteUrl,
        // Tope de memoria del proceso de build (el VPS comparte RAM con otras apps).
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=768`.trim(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Se guarda solo el final de la salida: alcanza para diagnosticar y no acumula memoria.
    let tail = '';
    const keepTail = (chunk: Buffer): void => {
      tail = (tail + chunk.toString()).slice(-4_000);
    };
    child.stdout.on('data', keepTail);
    child.stderr.on('data', keepTail);

    const timeout = setTimeout(() => child.kill('SIGKILL'), config.buildTimeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`astro build terminó con ${signal ?? `código ${code}`}:\n${tail}`));
    });
  });
}

/**
 * Una construcción completa: build -> verificación -> precompresión -> cambio atómico -> limpieza.
 * Si algo falla, la carpeta a medio hacer se borra y la versión publicada NO cambia.
 */
export async function buildAndActivate(config: BuilderConfig): Promise<BuildResult> {
  const startedAt = Date.now();
  const releaseDir = await createReleaseDir(config.siteDir);

  try {
    await runAstroBuild(config, releaseDir);
    // Sanidad mínima: un build "exitoso" sin página de inicio no se publica.
    await access(join(releaseDir, 'index.html'));

    const compressedFiles = await precompressSite(releaseDir);
    await activateRelease(config.siteDir, releaseDir);
    await pruneReleases(config.siteDir, config.keepReleases);

    return { release: releaseDir, durationMs: Date.now() - startedAt, compressedFiles };
  } catch (error) {
    await rm(releaseDir, { recursive: true, force: true });
    throw error;
  }
}
