import { activeReleaseName, readReleaseStamp } from './releases.ts';

/** First start: how many times the startup build is tried, and the wait between tries. */
export const STARTUP_BUILD_ATTEMPTS = 6;
export const STARTUP_BUILD_RETRY_MS = 10_000;

export interface StartupBuildOptions {
  attempts?: number;
  retryMs?: number;
  log: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** What the startup build needs of the BuildQueue. */
export interface StartupQueue {
  request(): void;
  whenIdle(): Promise<void>;
}

export type StartupOutcome = 'upToDate' | 'built' | 'failed';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * On startup the site is (re)built when there is none yet, or when the published release was built by another builder
 * version (a new image: new pages, styles, fonts). Through the same queue as POST /build, so it never overlaps a
 * build requested meanwhile. The API may take a few seconds to be ready (compose starts them together), so a failed
 * build is retried with a wait; if every attempt fails, the published site stays as it was.
 *
 * @param succeeded whether the build the queue just ran succeeded
 */
export async function buildOnStartup(
  siteDir: string,
  version: string,
  queue: StartupQueue,
  succeeded: () => boolean,
  { attempts = STARTUP_BUILD_ATTEMPTS, retryMs = STARTUP_BUILD_RETRY_MS, log, sleep = wait }: StartupBuildOptions,
): Promise<StartupOutcome> {
  const active = await activeReleaseName(siteDir);
  if (active) {
    const builtBy = await readReleaseStamp(siteDir, active);
    if (builtBy === version) return 'upToDate';
    log(`the published site was built by builder ${builtBy ?? '(unknown)'} and this is ${version}: rebuilding it`);
  } else {
    log('no site published yet: building it');
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    queue.request();
    await queue.whenIdle();
    if (succeeded()) return 'built';
    if (attempt === attempts) break;
    log(`startup build failed (attempt ${attempt}/${attempts}); retrying in ${retryMs / 1000} s`);
    await sleep(retryMs);
  }
  log('the startup build did not succeed. Publish a post or call POST /build to retry.');
  return 'failed';
}
