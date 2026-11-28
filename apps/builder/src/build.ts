import { spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuilderConfig } from './config.ts';
import { precompressSite } from './compress.ts';
import { activateRelease, createReleaseDir, pruneReleases, removeReleaseStamp, writeReleaseStamp } from './releases.ts';

export interface BuildResult {
  release: string;
  durationMs: number;
  compressedFiles: number;
}

/**
 * Runs `astro build` with a low CPU priority (nice) so it does not take resources from the other apps on the VPS. The
 * node_modules binary directly, without `pnpm exec`: the production image has no package manager.
 */
function runAstroBuild(config: BuilderConfig, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'node_modules/.bin/astro', 'build'], {
      cwd: config.webDir,
      env: {
        ...process.env,
        OUT_DIR: outDir,
        API_URL: config.apiUrl,
        BUILDER_TOKEN: config.token,
        SITE_URL: config.siteUrl,
        // Memory cap of the build process (the VPS shares RAM with other apps).
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=768`.trim(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Only the end of the output is kept: enough to diagnose, without piling up memory.
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
      else reject(new Error(`astro build ended with ${signal ?? `exit code ${code}`}:\n${tail}`));
    });
  });
}

/**
 * One full build: build -> check -> precompression -> version stamp -> atomic swap -> cleanup.
 * If anything fails, the half-built folder is deleted and the published version does NOT change.
 *
 * @param version the builder version that builds it (version.ts), recorded for the release before it goes live
 */
export async function buildAndActivate(config: BuilderConfig, version?: string): Promise<BuildResult> {
  const startedAt = Date.now();
  const releaseDir = await createReleaseDir(config.siteDir);

  try {
    await runAstroBuild(config, releaseDir);
    // Minimal sanity check: a "successful" build without a home page is not published.
    await access(join(releaseDir, 'index.html'));

    const compressedFiles = await precompressSite(releaseDir);
    if (version !== undefined) await writeReleaseStamp(config.siteDir, releaseDir, version);
    await activateRelease(config.siteDir, releaseDir);
    await pruneReleases(config.siteDir, config.keepReleases);

    return { release: releaseDir, durationMs: Date.now() - startedAt, compressedFiles };
  } catch (error) {
    await rm(releaseDir, { recursive: true, force: true });
    await removeReleaseStamp(config.siteDir, releaseDir);
    throw error;
  }
}
