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
 * Windows solo deja crear symlinks con el modo desarrollador o como administrador (si no, EPERM). Los tests del cambio
 * atómico necesitan symlinks reales: ahí se saltean con el motivo, y en Linux (Docker, CI, el VPS) corren siempre.
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
      return 'Windows no permite crear symlinks sin el modo desarrollador (EPERM)';
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const needsSymlinks = { skip: await symlinksUnsupported() };

describe('isAuthorized', () => {
  it('acepta el token correcto con esquema Bearer (sin distinguir mayúsculas en el esquema)', () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAuthorized(`bearer ${TOKEN}`, TOKEN), true);
  });

  it('rechaza token incorrecto, de otro largo, vacío o con otro esquema', () => {
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

  it('carga los valores y aplica los defaults', () => {
    const config = loadConfig(base);
    assert.equal(config.port, 4000);
    assert.equal(config.keepReleases, 3);
    assert.equal(config.siteDir, '/site');
  });

  it('falla si falta una variable obligatoria', () => {
    assert.throws(() => loadConfig({ ...base, API_URL: undefined }), /API_URL/);
  });

  it('falla si el token es corto', () => {
    assert.throws(() => loadConfig({ ...base, BUILDER_TOKEN: 'corto' }), /32 caracteres/);
  });

  it('falla con números inválidos en vez de usar NaN', () => {
    assert.throws(() => loadConfig({ ...base, PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ ...base, KEEP_RELEASES: '0' }), /KEEP_RELEASES/);
  });
});

describe('localUrl', () => {
  it('usa el PORT del entorno, o el de siempre si no hay', () => {
    assert.equal(localUrl('/health', { PORT: '4100' }), 'http://127.0.0.1:4100/health');
    assert.equal(localUrl('/build', {}), 'http://127.0.0.1:4000/build');
  });

  it('valida PORT igual que loadConfig: un valor inválido falla en vez de armar una URL rota', () => {
    assert.throws(() => localUrl('/health', { PORT: 'abc' }), /PORT debe ser un entero positivo \(recibido: "abc"\)/);
    assert.throws(() => localUrl('/health', { PORT: '0' }), /PORT/);
  });
});

describe('BuildQueue', () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('junta varios pedidos seguidos en una sola construcción', async () => {
    let runs = 0;
    const queue = new BuildQueue(async () => void (runs += 1), 20, () => undefined);

    queue.request();
    queue.request();
    queue.request();
    await queue.whenIdle();

    assert.equal(runs, 1);
  });

  it('un pedido durante una construcción agenda exactamente una más, sin solaparse', async () => {
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
    await sleep(40); // ya empezó a construir
    queue.request();
    queue.request();
    await queue.whenIdle();

    assert.equal(runs, 2);
    assert.equal(maxConcurrent, 1);
  });

  it('un error se informa y no frena la cola', async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const queue = new BuildQueue(
      async () => {
        runs += 1;
        if (runs === 1) throw new Error('falló');
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

  it('whenIdle se resuelve enseguida si no hay nada pendiente', async () => {
    const queue = new BuildQueue(async () => undefined, 5, () => undefined);
    await queue.whenIdle();
    assert.equal(queue.isBusy, false);
  });
});

describe('releases (cambio atómico por symlink)', () => {
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

  it('createReleaseDir nombra las carpetas por fecha UTC', async () => {
    const dir = await createReleaseDir(siteDir, new Date('2026-11-25T12:00:00.123Z'));
    assert.ok(dir.endsWith(join('releases', '20261125T120000123Z')));
    await access(dir);
  });

  it('activateRelease crea `current` con destino RELATIVO', needsSymlinks, async () => {
    const dir = await makeRelease('2026-11-25T10:00:00Z', 'v1');
    await activateRelease(siteDir, dir);

    const target = await readlink(join(siteDir, 'current'));
    assert.equal(target, join('releases', '20261125T100000000Z'));
    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('activar otra versión reemplaza el symlink y no deja temporales', needsSymlinks, async () => {
    const first = await makeRelease('2026-11-25T10:00:00Z', 'v1');
    const second = await makeRelease('2026-11-25T11:00:00Z', 'v2');

    await activateRelease(siteDir, first);
    await activateRelease(siteDir, second);

    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v2');
    assert.equal((await lstat(join(siteDir, 'current'))).isSymbolicLink(), true);
    const leftovers = (await readdir(siteDir)).filter((name) => name.startsWith('.current-'));
    assert.deepEqual(leftovers, []);
  });

  it('mientras se cambia de versión, `current` siempre se puede leer (nunca está roto)', needsSymlinks, async () => {
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
    await reader; // si el cambio no fuera atómico, readFile fallaría con ENOENT y esto lanzaría

    assert.ok([...seen].every((html) => html === 'v1' || html === 'v2'));
  });

  it('activeReleaseName devuelve undefined si todavía no hay versión activa', async () => {
    assert.equal(await activeReleaseName(siteDir), undefined);
  });

  it('pruneReleases conserva las N más nuevas y la activa', needsSymlinks, async () => {
    const dirs = [];
    for (let hour = 1; hour <= 5; hour += 1) dirs.push(await makeRelease(`2026-11-25T0${hour}:00:00Z`, `v${hour}`));
    await activateRelease(siteDir, dirs[0]!); // la activa es la MÁS VIEJA (por ejemplo tras un rollback)

    const removed = await pruneReleases(siteDir, 2);

    const remaining = (await readdir(join(siteDir, 'releases'))).sort();
    assert.deepEqual(remaining, ['20261125T010000000Z', '20261125T040000000Z', '20261125T050000000Z']);
    assert.equal(removed.length, 2);
    assert.equal(await readFile(join(siteDir, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('pruneReleases sin carpeta releases no falla', async () => {
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

  it('crea .br y .gz que descomprimen al contenido original', async () => {
    const html = `<!doctype html><title>x</title>${'<p>hola mundo</p>'.repeat(100)}`;
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

  it('ignora archivos chicos y formatos ya comprimidos', async () => {
    await writeFile(join(dir, 'chico.html'), '<p>x</p>');
    await writeFile(join(dir, 'font.woff2'), Buffer.alloc(5_000, 1));
    await writeFile(join(dir, 'foto.png'), Buffer.alloc(5_000, 2));

    assert.equal(await precompressSite(dir), 0);
    assert.deepEqual((await readdir(dir)).sort(), ['chico.html', 'font.woff2', 'foto.png']);
  });
});
