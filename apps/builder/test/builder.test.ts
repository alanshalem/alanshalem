import assert from 'node:assert/strict';
import { access, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { isAuthorized } from '../src/auth.ts';
import { precompressSite } from '../src/compress.ts';
import { loadConfig, localUrl } from '../src/config.ts';
import { BuildQueue } from '../src/queue.ts';
import { activateRelease, activeReleaseName, createReleaseDir, pruneReleases } from '../src/releases.ts';

const TOKEN = 'a'.repeat(40);

/**
 * Windows only lets you create symlinks in Developer Mode or as an administrator (otherwise EPERM). The atomic swap
 * tests need real symlinks: there they are skipped with the reason, and on Linux (Docker, CI, the VPS) they always run.
 */
async function symlinksUnsupported(): Promise<string | false> {
  const dir = await mkdtemp(join(tmpdir(), 'blog-symlink-probe-'));
  try {
    await mkdir(join(dir, 'target'));
    await symlink('target', join(dir, 'link'), 'dir');
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' && process.platform === 'win32') {
      return 'Windows does not allow creating symlinks without Developer Mode (EPERM)';
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const needsSymlinks = { skip: await symlinksUnsupported() };

describe('isAuthorized', () => {
  it('accepts the right token with the Bearer scheme (case-insensitive scheme)', () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAuthorized(`bearer ${TOKEN}`, TOKEN), true);
  });

  it('rejects a wrong token, one of another length, an empty one or another scheme', () => {
    assert.equal(isAuthorized(`Bearer ${'b'.repeat(40)}`, TOKEN), false);
    assert.equal(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(isAuthorized('Bearer ', TOKEN), false);
    assert.equal(isAuthorized(TOKEN, TOKEN), false);
    assert.equal(isAuthorized(`Basic ${TOKEN}`, TOKEN), false);
    assert.equal(isAuthorized(undefined, TOKEN), false);
  });
});

describe('loadConfig', () => {
  const base = { BUILDER_TOKEN: TOKEN, SITE_DIR: '/site', WEB_DIR: '/app/apps/web', API_URL: 'http://api:8080', SITE_URL: 'https://x.com' };

  it('loads the values and applies the defaults', () => {
    const config = loadConfig(base);
    assert.equal(config.port, 4000);
    assert.equal(config.keepReleases, 3);
    assert.equal(config.siteDir, '/site');
  });

  it('fails when a required variable is missing', () => {
    assert.throws(() => loadConfig({ ...base, API_URL: undefined }), /API_URL/);
  });

  it('fails when the token is short', () => {
    assert.throws(() => loadConfig({ ...base, BUILDER_TOKEN: 'short' }), /at least 32 characters/);
  });

  it('fails on invalid numbers instead of using NaN', () => {
    assert.throws(() => loadConfig({ ...base, PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ ...base, KEEP_RELEASES: '0' }), /KEEP_RELEASES/);
  });
});

describe('localUrl', () => {
  it('uses the PORT from the environment, or the usual one when there is none', () => {
    assert.equal(localUrl('/health', { PORT: '4100' }), 'http://127.0.0.1:4100/health');
    assert.equal(localUrl('/build', {}), 'http://127.0.0.1:4000/build');
  });

  it('validates PORT like loadConfig: an invalid value fails instead of building a broken URL', () => {
    assert.throws(() => localUrl('/health', { PORT: 'abc' }), /PORT must be a positive integer \(got: "abc"\)/);
    assert.throws(() => localUrl('/health', { PORT: '0' }), /PORT/);
  });
});

describe('BuildQueue', () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('merges several requests in a row into one build', async () => {
    let runs = 0;
    const queue = new BuildQueue(async () => void (runs += 1), 20, () => undefined);

    queue.request();
    queue.request();
    queue.request();
    await queue.whenIdle();

    assert.equal(runs, 1);
  });

  it('a request during a build schedules exactly one more, without overlapping', async () => {
    let runs = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const queue = new BuildQueue(
      async () => {
        runs += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(60);
        concurrent -= 1;
      },
      10,
      () => undefined,
    );

    queue.request();
    await sleep(40); // the build has started
    queue.request();
    queue.request();
    await queue.whenIdle();

    assert.equal(runs, 2);
    assert.equal(maxConcurrent, 1);
  });

  it('an error is reported and does not stop the queue', async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const queue = new BuildQueue(
      async () => {
        runs += 1;
        if (runs === 1) throw new Error('failed');
      },
      5,
      (error) => errors.push(error),
    );

    queue.request();
    await queue.whenIdle();
    queue.request();
    await queue.whenIdle();

    assert.equal(runs, 2);
    assert.equal(errors.length, 1);
  });

  it('whenIdle resolves right away when nothing is pending', async () => {
    const queue = new BuildQueue(async () => undefined, 5, () => undefined);
    await queue.whenIdle();
    assert.equal(queue.isBusy, false);
  });
});

describe('releases (atomic swap by symlink)', () => {
  let siteDir: string;

  beforeEach(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'blog-site-'));
  });
  afterEach(async () => {
    await rm(siteDir, { recursive: true, force: true });
  });

  const makeRelease = async (isoDate: string, html: string): Promise<string> => {
    const dir = await createReleaseDir(siteDir, new Date(isoDate));
    await writeFile(join(dir, 'index.html'), html);
    return dir;
  };

  it('createReleaseDir names the folders by UTC date', async () => {
    const dir = await createReleaseDir(siteDir, new Date('2026-11-25T12:00:00.123Z'));
    assert.ok(dir.endsWith(join('releases', '20261125T120000123Z')));
    await access(dir);
  });

  it('activateRelease creates `current` with a RELATIVE target', needsSymlinks, async () => {
    const dir = await makeRelease('2026-11-25T10:00:00Z', 'v1');
    await activateRelease(siteDir, dir);

    const target = await readlink(join(siteDir, 'current'));
    assert.equal(target, join('releases', '20261125T100000000Z'));
    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('activating another version replaces the symlink and leaves no temporary files', needsSymlinks, async () => {
    const first = await makeRelease('2026-11-25T10:00:00Z', 'v1');
    const second = await makeRelease('2026-11-25T11:00:00Z', 'v2');

    await activateRelease(siteDir, first);
    await activateRelease(siteDir, second);

    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v2');
    assert.equal((await lstat(join(siteDir, 'current'))).isSymbolicLink(), true);
    const leftovers = (await readdir(siteDir)).filter((name) => name.startsWith('.current-'));
    assert.deepEqual(leftovers, []);
  });

  it('while the version changes, `current` can always be read (it is never broken)', needsSymlinks, async () => {
    const first = await makeRelease('2026-11-25T10:00:00Z', 'v1');
    const second = await makeRelease('2026-11-25T11:00:00Z', 'v2');
    await activateRelease(siteDir, first);

    const seen = new Set<string>();
    let stop = false;
    const reader = (async () => {
      while (!stop) seen.add(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'));
    })();

    for (let i = 0; i < 100; i += 1) await activateRelease(siteDir, i % 2 === 0 ? second : first);
    stop = true;
    await reader; // if the swap were not atomic, readFile would fail with ENOENT and this would throw

    assert.ok([...seen].every((html) => html === 'v1' || html === 'v2'));
  });

  it('activeReleaseName returns undefined when there is no active version yet', async () => {
    assert.equal(await activeReleaseName(siteDir), undefined);
  });

  it('pruneReleases keeps the N newest and the active one', needsSymlinks, async () => {
    const dirs = [];
    for (let hour = 1; hour <= 5; hour += 1) dirs.push(await makeRelease(`2026-11-25T0${hour}:00:00Z`, `v${hour}`));
    await activateRelease(siteDir, dirs[0]!); // the active one is the OLDEST (for example after a rollback)

    const removed = await pruneReleases(siteDir, 2);

    const remaining = (await readdir(join(siteDir, 'releases'))).sort();
    assert.deepEqual(remaining, ['20261125T010000000Z', '20261125T040000000Z', '20261125T050000000Z']);
    assert.equal(removed.length, 2);
    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('pruneReleases without a releases folder does not fail', async () => {
    assert.deepEqual(await pruneReleases(siteDir, 3), []);
  });
});

describe('precompressSite', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blog-compress-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates .br and .gz that decompress to the original content', async () => {
    const html = `<!doctype html><title>x</title>${'<p>hello world</p>'.repeat(100)}`;
    await mkdir(join(dir, 'articulos'));
    await writeFile(join(dir, 'articulos', 'index.html'), html);

    const count = await precompressSite(dir);

    assert.equal(count, 1);
    const br = await readFile(join(dir, 'articulos', 'index.html.br'));
    const gz = await readFile(join(dir, 'articulos', 'index.html.gz'));
    assert.equal(brotliDecompressSync(br).toString(), html);
    assert.equal(gunzipSync(gz).toString(), html);
    assert.ok(br.length < html.length / 5);
  });

  it('skips small files and already compressed formats', async () => {
    await writeFile(join(dir, 'small.html'), '<p>x</p>');
    await writeFile(join(dir, 'font.woff2'), Buffer.alloc(5_000, 1));
    await writeFile(join(dir, 'photo.png'), Buffer.alloc(5_000, 2));

    assert.equal(await precompressSite(dir), 0);
    assert.deepEqual((await readdir(dir)).sort(), ['font.woff2', 'photo.png', 'small.html']);
  });
});
