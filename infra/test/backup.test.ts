import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// backup.sh y restore.sh con un `docker` falso en el PATH: cada `docker compose exec|run … sh -euc SCRIPT` corre SCRIPT
// acá, con /data y /media apuntando a carpetas temporales, y `dotnet Blog.Api.dll backup` copia la base de prueba
// (como el comando real, imprime la ruta). La prueba con Docker de verdad (backup con el sitio andando, borrar los
// volúmenes y restaurar) está en el Log de la tarea. Los scripts son para el VPS (Linux): en Windows se saltean.
const skip = process.platform === 'win32' ? 'los scripts de backup corren en Linux (en Windows, probalos en Docker)' : false;
const script = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url));

const FAKE_DOCKER = String.raw`#!/bin/sh
echo "$*" >>"$FAKE_ROOT/calls"
shift                                   # compose
[ "$1" = --env-file ] && shift 2
case " $* " in *' -euc '*) ;; *) exit 0 ;; esac      # stop, up, init-permisos, request-build: solo se registran
for last; do :; done                    # el script es el último argumento
mapped=$(printf %s "$last" | sed "s#/data#$FAKE_ROOT/data#g; s#/media#$FAKE_ROOT/media#g")
PATH="$FAKE_ROOT/bin:$PATH" exec sh -euc "$mapped"
`;

const FAKE_DOTNET = String.raw`#!/bin/sh
[ "$1 $2" = "Blog.Api.dll backup" ] || exit 64
[ -z "$FAKE_BACKUP_FAIL" ] || { echo "No se pudo hacer la copia de respaldo: falla de prueba" >&2; exit 1; }
cp "$FAKE_ROOT/data/blog.db" "$3/blog-20261126T030000Z.db"
echo "$3/blog-20261126T030000Z.db"
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

describe('backup.sh y restore.sh', { skip }, () => {
  let root: string;
  let backups: string;

  const sh = (name: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<Run> =>
    new Promise((resolve) => {
      execFile(
        'sh',
        [script(name), ...args],
        { env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FAKE_ROOT: root, BACKUP_DIR: backups, ...env } },
        (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      );
    });
  // Dos backups en el mismo segundo tendrían el mismo nombre: entre corrida y corrida se espera.
  const nextSecond = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_100));
  const list = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blog-backup-'));
    backups = join(root, 'backups');
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'data', 'keys'), { recursive: true });
    await mkdir(join(root, 'data', 'backups'));
    await mkdir(join(root, 'media', 'abc'), { recursive: true });
    await writeFile(join(root, 'bin', 'docker'), FAKE_DOCKER);
    await writeFile(join(root, 'bin', 'dotnet'), FAKE_DOTNET);
    await chmod(join(root, 'bin', 'docker'), 0o755);
    await chmod(join(root, 'bin', 'dotnet'), 0o755);
    await writeFile(join(root, 'data', 'blog.db'), 'SQLite format 3\0base de prueba');
    await writeFile(join(root, 'data', 'keys', 'key-1.xml'), '<key/>');
    await writeFile(join(root, 'media', 'abc', '640.webp'), 'imagen');
    await writeFile(join(root, 'media', 'abc', '1024.webp.0f.tmp'), 'subida en curso');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copia base, claves y media (sin los .tmp), y no deja la copia de la base en el volumen', async () => {
    const result = await sh('backup.sh');

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    const [stamp] = await list(join(backups, 'daily'));
    assert.match(stamp!, /^\d{8}T\d{6}Z$/);
    assert.deepEqual(await list(join(backups, 'daily', stamp!)), ['blog.db', 'keys.tar']);
    assert.equal(await readFile(join(backups, 'daily', stamp!, 'blog.db'), 'utf8'), 'SQLite format 3\0base de prueba');
    assert.deepEqual(await list(join(backups, 'media', 'abc')), ['640.webp']);
    assert.deepEqual(await list(join(root, 'data', 'backups')), []);
    assert.deepEqual(await list(join(backups, 'weekly')), [stamp]);
    assert.match(result.stderr, /media: 1 archivos nuevos, 1 en total/);
    assert.match(result.stderr, /sin BACKUP_RCLONE_REMOTE: el backup queda solo en /);
    // El comando del contrato L10, dentro del contenedor de la API en marcha.
    assert.match(await readFile(join(root, 'calls'), 'utf8'), /exec -T api sh -euc db=\$\(dotnet Blog\.Api\.dll backup \/data\/backups\)/);
  });

  it('la segunda vez copia solo la media nueva', async () => {
    await sh('backup.sh');
    await writeFile(join(root, 'media', 'abc', '1024.webp'), 'otra');
    await nextSecond();

    const result = await sh('backup.sh');

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /media: 1 archivos nuevos, 2 en total/);
    assert.deepEqual(await list(join(backups, 'media', 'abc')), ['1024.webp', '640.webp']);
  });

  it('rota: quedan los 7 diarios y los 4 semanales más nuevos; un semanal por semana', async () => {
    for (let day = 1; day <= 8; day += 1) await mkdir(join(backups, 'daily', `202611${String(day).padStart(2, '0')}T030000Z`), { recursive: true });
    for (const week of ['20261001', '20261008', '20261015', '20261022']) {
      const dir = join(backups, 'weekly', `${week}T030000Z`);
      await mkdir(dir, { recursive: true });
      await utimes(dir, new Date(`${week.slice(0, 4)}-${week.slice(4, 6)}-${week.slice(6)}`), new Date('2026-10-22'));
    }

    const result = await sh('backup.sh');

    assert.equal(result.code, 0, result.stderr);
    const daily = await list(join(backups, 'daily'));
    assert.equal(daily.length, 7);
    assert.deepEqual(daily.slice(0, 6), ['20261103T030000Z', '20261104T030000Z', '20261105T030000Z', '20261106T030000Z', '20261107T030000Z', '20261108T030000Z']);
    const weekly = await list(join(backups, 'weekly'));
    assert.deepEqual(weekly.slice(0, 3), ['20261008T030000Z', '20261015T030000Z', '20261022T030000Z']);
    assert.equal(weekly[3], daily[6], 'el semanal nuevo es el diario de hoy (no había uno de los últimos 7 días)');

    // Otra corrida la misma semana: diario nuevo, semanal no.
    await nextSecond();
    assert.equal((await sh('backup.sh')).code, 0);
    assert.deepEqual(await list(join(backups, 'weekly')), weekly);
  });

  it('si la API no puede copiar la base, falla y no deja un snapshot a medias', async () => {
    const result = await sh('backup.sh', [], { FAKE_BACKUP_FAIL: '1' });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /No se pudo hacer la copia de respaldo: falla de prueba/);
    assert.deepEqual(await list(join(backups, 'daily')), []);
  });

  it('con BACKUP_RCLONE_REMOTE pero sin rclone, avisa y el backup local queda', async () => {
    const result = await sh('backup.sh', [], { BACKUP_RCLONE_REMOTE: 'b2:bucket/blog' });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /BACKUP_RCLONE_REMOTE está definido pero rclone no está instalado/);
  });

  it('restore sin --apply solo revisa: no para nada ni toca la base', async () => {
    await sh('backup.sh');
    const [stamp] = await list(join(backups, 'daily'));
    await writeFile(join(root, 'data', 'blog.db'), 'SQLite format 3\0base nueva');
    await rm(join(root, 'calls'));

    const result = await sh('restore.sh', [join(backups, 'daily', stamp!)]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /snapshot válido: base \d+ bytes, 1 claves, 1 archivos de media/);
    assert.match(result.stderr, /Simulación: no se cambió nada\. Con --apply:/);
    assert.equal(await readFile(join(root, 'data', 'blog.db'), 'utf8'), 'SQLite format 3\0base nueva');
    await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
  });

  it('restore --apply reemplaza base y claves, descarta el -wal y agrega la media que falta', async () => {
    await sh('backup.sh');
    const [stamp] = await list(join(backups, 'daily'));
    await writeFile(join(root, 'data', 'blog.db'), 'SQLite format 3\0base nueva');
    await writeFile(join(root, 'data', 'blog.db-wal'), 'wal de la base nueva');
    await rm(join(root, 'data', 'keys'), { recursive: true });
    await rm(join(root, 'media', 'abc', '640.webp'));

    const result = await sh('restore.sh', [join(backups, 'daily', stamp!), '--apply']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(join(root, 'data', 'blog.db'), 'utf8'), 'SQLite format 3\0base de prueba');
    assert.deepEqual((await list(join(root, 'data'))).filter((name) => name.startsWith('blog.db')), ['blog.db']);
    assert.deepEqual(await list(join(root, 'data', 'keys')), ['key-1.xml']);
    assert.equal(await readFile(join(root, 'media', 'abc', '640.webp'), 'utf8'), 'imagen');
    const calls = await readFile(join(root, 'calls'), 'utf8');
    for (const step of ['run --rm init-permisos', 'stop api builder', 'up -d --wait', 'exec -T builder node src/request-build.ts']) {
      assert.ok(calls.includes(step), step);
    }
  });

  it('restore: sin snapshot explica el uso; con uno inválido no hace nada', async () => {
    assert.deepEqual(await sh('restore.sh'), { code: 2, stdout: '', stderr: 'Uso: sh restore.sh <carpeta del snapshot> [--apply]\n' });
    const result = await sh('restore.sh', [join(backups, 'nada'), '--apply']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /nada\/blog\.db no existe o no es una base SQLite/);
    await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
  });
});
