import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildAndActivate } from '../src/build.ts';
import { loadConfig } from '../src/config.ts';
import { buildOnStartup } from '../src/startup.ts';
import { activateRelease, createReleaseDir, pruneReleases, readReleaseStamp, writeReleaseStamp } from '../src/releases.ts';
import { resolveBuilderVersion, sourceHash } from '../src/version.ts';

/*
 * A new builder image brings new site code (fonts, styles, renderer): when it starts and the published release was
 * built by another version, it rebuilds once, through its own queue and with the first-build retries.
 */

async function symlinksUnsupported(): Promise<string | false> {
  const dir = await mkdtemp(join(tmpdir(), 'blog-symlink-probe-'));
  try {
    await mkdir(join(dir, 'target'));
    await symlink('target', join(dir, 'link'), 'dir');
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' && process.platform === 'win32') {
      return 'Windows does not allow creating symlinks without Developer Mode (EPERM)';
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const needsSymlinks = { skip: await symlinksUnsupported() };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blog-startup-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A queue whose builds succeed or fail as scripted; a successful one publishes a release stamped with `version`. */
function fakeQueue(outcomes: boolean[], version = 'v2') {
  let ok = false;
  const requests: number[] = [];
  return {
    requests,
    succeeded: () => ok,
    queue: {
      request: () => void requests.push(requests.length + 1),
      whenIdle: async () => {
        ok = outcomes[requests.length - 1] ?? false;
        if (ok) {
          const release = await createReleaseDir(dir, new Date(Date.UTC(2026, 10, 27, 12, 0, requests.length)));
          await writeReleaseStamp(dir, release, version);
          await activateRelease(dir, release);
        }
      },
    },
  };
}

const noWait = { attempts: 3, retryMs: 0, sleep: async () => undefined };

async function publish(version: string | undefined): Promise<string> {
  const release = await createReleaseDir(dir, new Date('2026-11-20T10:00:00Z'));
  await writeFile(join(release, 'index.html'), 'old');
  if (version !== undefined) await writeReleaseStamp(dir, release, version);
  await activateRelease(dir, release);
  return release;
}

describe('release stamps', () => {
  it('a stamp is read back for its release and lives outside the served folder', needsSymlinks, async () => {
    const release = await publish('sha-abc');
    assert.equal(await readReleaseStamp(dir, release), 'sha-abc');
    assert.deepEqual(await readdir(release), ['index.html']); // Caddy serves the release folder: no stamp in it
  });

  it('a release built before stamps existed has none', async () => {
    const release = await createReleaseDir(dir);
    assert.equal(await readReleaseStamp(dir, release), undefined);
  });

  it('pruning a release removes its stamp too', needsSymlinks, async () => {
    const releases: string[] = [];
    for (let hour = 1; hour <= 3; hour += 1) {
      const release = await createReleaseDir(dir, new Date(`2026-11-25T0${hour}:00:00Z`));
      await writeReleaseStamp(dir, release, `v${hour}`);
      releases.push(release);
    }
    await activateRelease(dir, releases[2]!);

    await pruneReleases(dir, 1);

    assert.deepEqual(await readdir(join(dir, 'releases')), ['20261125T030000000Z']);
    assert.equal(await readReleaseStamp(dir, releases[0]!), undefined);
    assert.equal(await readReleaseStamp(dir, releases[2]!), 'v3');
  });
});

describe('a build stamps its release', () => {
  // A fake `astro build` (a shell script) run through `nice`, as in the image: Linux only, like the container.
  const linuxOnly = { skip: process.platform === 'win32' ? 'runs `nice` and a shell script, as the Linux image does' : false };

  const fakeWeb = async (script: string): Promise<string> => {
    const web = join(dir, 'web');
    await mkdir(join(web, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(web, 'node_modules', '.bin', 'astro'), `#!/bin/sh\n${script}\n`);
    await chmod(join(web, 'node_modules', '.bin', 'astro'), 0o755);
    return web;
  };
  const configFor = (web: string) =>
    loadConfig({ BUILDER_TOKEN: 'a'.repeat(40), SITE_DIR: join(dir, 'site'), WEB_DIR: web, API_URL: 'http://api', SITE_URL: 'https://x.com' });

  it('a successful build records the builder version of the release it publishes', linuxOnly, async () => {
    const config = configFor(await fakeWeb('echo "<h1>hola</h1>" > "$OUT_DIR/index.html"'));

    const result = await buildAndActivate(config, 'sha-new');

    assert.equal(await readReleaseStamp(config.siteDir, result.release), 'sha-new');
    assert.equal(await readFile(join(config.siteDir, 'current', 'index.html'), 'utf8'), '<h1>hola</h1>\n');
  });

  it('a failed build leaves no release and no stamp behind', linuxOnly, async () => {
    const config = configFor(await fakeWeb('exit 1'));

    await assert.rejects(buildAndActivate(config, 'sha-new'), /astro build ended with exit code 1/);

    assert.deepEqual(await readdir(join(config.siteDir, 'releases')), []);
    await assert.rejects(readdir(join(config.siteDir, 'stamps')), { code: 'ENOENT' });
  });
});

describe('build on startup', () => {
  it('without a published site it builds, retrying until one succeeds (the first-build retry)', needsSymlinks, async () => {
    const logs: string[] = [];
    const fake = fakeQueue([false, true]);

    const outcome = await buildOnStartup(dir, 'v2', fake.queue, fake.succeeded, { ...noWait, log: (line) => logs.push(line) });

    assert.equal(outcome, 'built');
    assert.deepEqual(fake.requests, [1, 2]);
    assert.match(logs[0] ?? '', /no site published yet/);
  });

  it('the published release of this same version is left alone', needsSymlinks, async () => {
    await publish('v2');
    const fake = fakeQueue([true]);

    assert.equal(await buildOnStartup(dir, 'v2', fake.queue, fake.succeeded, { ...noWait, log: () => undefined }), 'upToDate');
    assert.deepEqual(fake.requests, []);
  });

  it('a release built by another version is rebuilt once, saying why', needsSymlinks, async () => {
    await publish('v1');
    const logs: string[] = [];
    const fake = fakeQueue([true]);

    const outcome = await buildOnStartup(dir, 'v2', fake.queue, fake.succeeded, { ...noWait, log: (line) => logs.push(line) });

    assert.equal(outcome, 'built');
    assert.deepEqual(fake.requests, [1]);
    assert.equal(logs[0], 'the published site was built by builder v1 and this is v2: rebuilding it');
  });

  it('a release without a stamp (built before this version) is rebuilt once', needsSymlinks, async () => {
    await publish(undefined);
    const logs: string[] = [];
    const fake = fakeQueue([true]);

    assert.equal(await buildOnStartup(dir, 'v2', fake.queue, fake.succeeded, { ...noWait, log: (line) => logs.push(line) }), 'built');
    assert.deepEqual(fake.requests, [1]);
    assert.equal(logs[0], 'the published site was built by builder (unknown) and this is v2: rebuilding it');
  });

  it('gives up after the attempts and keeps the published site', needsSymlinks, async () => {
    const release = await publish('v1');
    const logs: string[] = [];
    const fake = fakeQueue([false, false, false, true]);

    const outcome = await buildOnStartup(dir, 'v2', fake.queue, fake.succeeded, { ...noWait, log: (line) => logs.push(line) });

    assert.equal(outcome, 'failed');
    assert.deepEqual(fake.requests, [1, 2, 3]);
    await access(join(release, 'index.html'));
    assert.match(logs.at(-1) ?? '', /did not succeed/);
  });
});

describe('builder version', () => {
  it('BUILDER_VERSION from the image wins (trimmed)', async () => {
    assert.equal(await resolveBuilderVersion({ BUILDER_VERSION: ' sha-0123abc ' }, [dir]), 'sha-0123abc');
  });

  it('without it, a hash of the site sources: stable, and different when a source changes', async () => {
    const web = join(dir, 'web');
    await mkdir(join(web, 'src'), { recursive: true });
    await writeFile(join(web, 'src', 'page.astro'), '<h1>hola</h1>');
    await mkdir(join(web, 'public', 'fonts'), { recursive: true });
    await writeFile(join(web, 'public', 'fonts', 'math.woff2'), Buffer.from([1, 2, 3]));

    const first = await resolveBuilderVersion({}, [web, join(dir, 'missing')]);
    assert.match(first, /^sources-[0-9a-f]{16}$/);
    assert.equal(await resolveBuilderVersion({ BUILDER_VERSION: '' }, [web]), first);

    await writeFile(join(web, 'public', 'fonts', 'math.woff2'), Buffer.from([1, 2, 4]));
    assert.notEqual(await resolveBuilderVersion({}, [web]), first);
  });

  it('the hash ignores dependencies and build output (node_modules, .astro, dist)', async () => {
    const web = join(dir, 'web');
    await mkdir(join(web, 'src'), { recursive: true });
    await writeFile(join(web, 'src', 'a.ts'), 'export {}');
    const before = await sourceHash([web]);

    for (const ignored of ['node_modules', '.astro', 'dist']) {
      await mkdir(join(web, ignored), { recursive: true });
      await writeFile(join(web, ignored, 'x.js'), String(Math.random()));
    }

    assert.equal(await sourceHash([web]), before);
  });

  it('a renamed file changes the hash even with the same content', async () => {
    await writeFile(join(dir, 'a.txt'), 'same');
    const before = await sourceHash([dir]);
    await rm(join(dir, 'a.txt'));
    await writeFile(join(dir, 'b.txt'), 'same');
    assert.notEqual(await sourceHash([dir]), before);
  });
});
