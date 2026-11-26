import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// backup.sh y restore.sh con un `docker` falso en el PATH: cada `docker compose exec|run … sh -euc SCRIPT` corre SCRIPT
// acá, con /data y /media apuntando a carpetas temporales; `dotnet Blog.Api.dll backup` copia la base de prueba (como
// el comando real, imprime la ruta) y el chequeo de integridad corre con el node de esta máquina (node:sqlite). Las
// variables FAKE_* simulan las fallas: la API caída, un healthcheck que no da sano, una conexión que se corta a mitad
// del stream. La prueba con Docker de verdad (backup con el sitio andando, borrar los volúmenes y restaurar) se corre a
// mano con la copia local de producción. Los scripts son para el VPS (Linux): en Windows se saltean.
const skip = process.platform === 'win32' ? 'los scripts de backup corren en Linux (en Windows, probalos en Docker)' : false;
const script = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url));

const FAKE_DOCKER = String.raw`#!/bin/sh
echo "$*" >>"$FAKE_ROOT/calls"
shift                                   # compose
[ "$1" = --env-file ] && shift 2
case $1 in
ps) [ -n "$FAKE_API_DOWN" ] || echo fake-api-container; exit 0 ;;
up)
	if [ -n "$FAKE_UP_FAIL" ] && [ ! -e "$FAKE_ROOT/up-failed" ]; then
		: >"$FAKE_ROOT/up-failed"
		echo "container blog-api-1 is unhealthy" >&2
		exit 1
	fi
	exit 0 ;;
esac
case " $* " in *' -euc '*) ;; *) exit 0 ;; esac      # stop, init-permisos, request-build: solo se registran
for last; do :; done                    # el script es el último argumento
mapped=$(printf %s "$last" | sed "s#/data#$FAKE_ROOT/data#g; s#/media#$FAKE_ROOT/media#g")
run() { PATH="$FAKE_ROOT/bin:$PATH" sh -euc "$mapped"; }
# La conexión se corta a mitad del stream y docker igual sale con 0 (el peor caso: nadie avisa).
if [ -n "$FAKE_CUT_IN" ] && printf %s "$last" | grep -qF -- "$FAKE_CUT_IN"; then
	head -c "$FAKE_CUT_BYTES" | run
elif [ -n "$FAKE_CUT_OUT" ] && printf %s "$last" | grep -qF -- "$FAKE_CUT_OUT"; then
	run | head -c "$FAKE_CUT_BYTES"
else
	run
fi
`;

const FAKE_DOTNET = String.raw`#!/bin/sh
[ "$1 $2" = "Blog.Api.dll backup" ] || exit 64
[ -z "$FAKE_BACKUP_FAIL" ] || { echo "No se pudo hacer la copia de respaldo: falla de prueba" >&2; exit 1; }
cp "$FAKE_ROOT/data/blog.db" "$3/blog-20261126T030000Z.db"
echo "$3/blog-20261126T030000Z.db" | sed "s#^$FAKE_ROOT##"     # la ruta como la ve el contenedor
`;

// rclone falso: registra cada llamada; listremotes y lsf responden lo que diga el test.
const FAKE_RCLONE = String.raw`#!/bin/sh
echo "rclone $*" >>"$FAKE_ROOT/calls"
case $1 in
listremotes) printf '%s\n' "$FAKE_RCLONE_REMOTES" ;;
lsf) printf '%s\n' "$FAKE_RCLONE_LSF" ;;
esac
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Una base SQLite de verdad (el chequeo de integridad la abre) con un solo valor adentro. */
function writeDb(path: string, value: string): void {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE t (v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run(value);
  db.close();
}

function readDb(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare('SELECT v FROM t').get() as { v: string };
  db.close();
  return row.v;
}

describe('backup.sh y restore.sh', { skip }, () => {
  let root: string;
  let backups: string;

  const sh = (name: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<Run> =>
    new Promise((resolve) => {
      execFile(
        'sh',
        [script(name), ...args],
        {
          env: {
            ...process.env,
            PATH: `${root}/bin:${process.env.PATH}`,
            FAKE_ROOT: root,
            FAKE_CUT_BYTES: '515',
            BACKUP_DIR: backups,
            ...env,
          },
        },
        (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      );
    });
  // Dos backups en el mismo segundo tendrían el mismo nombre: entre corrida y corrida se espera.
  const nextSecond = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_100));
  const list = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();
  const calls = (): Promise<string> => readFile(join(root, 'calls'), 'utf8');
  const live = (path: string): string => join(root, 'data', path);
  const latest = async (): Promise<string> => join(backups, 'daily', (await list(join(backups, 'daily'))).at(-1)!);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blog-backup-'));
    backups = join(root, 'backups');
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'data', 'keys'), { recursive: true });
    await mkdir(join(root, 'data', 'backups'));
    await mkdir(join(root, 'media', 'abc'), { recursive: true });
    for (const [name, text] of [['docker', FAKE_DOCKER], ['dotnet', FAKE_DOTNET]] as const) {
      await writeFile(join(root, 'bin', name), text);
      await chmod(join(root, 'bin', name), 0o755);
    }
    writeDb(live('blog.db'), 'base de prueba');
    await writeFile(live('keys/key-1.xml'), '<key/>');
    await writeFile(join(root, 'media', 'abc', '640.webp'), 'imagen');
    await writeFile(join(root, 'media', 'abc', '1024.webp.0f.tmp'), 'subida en curso');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('backup.sh', () => {
    it('copia base, claves y media (sin los .tmp), y no deja la copia de la base en el volumen', async () => {
      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const [stamp] = await list(join(backups, 'daily'));
      assert.match(stamp!, /^\d{8}T\d{6}Z$/);
      assert.deepEqual(await list(join(backups, 'daily', stamp!)), ['blog.db', 'keys.tar']);
      assert.equal(readDb(join(backups, 'daily', stamp!, 'blog.db')), 'base de prueba');
      assert.deepEqual(await list(join(backups, 'media', 'abc')), ['640.webp']);
      assert.deepEqual(await list(live('backups')), []);
      assert.deepEqual(await list(join(backups, 'weekly')), [stamp]);
      assert.match(result.stderr, /media: 1 archivos nuevos, 1 en total/);
      assert.match(result.stderr, /sin BACKUP_RCLONE_REMOTE: el backup queda solo en /);
      // El comando `backup` de la API, dentro de su contenedor en marcha; y la base revisada con integrity_check.
      const log = await calls();
      assert.match(log, /exec -T api sh -euc dotnet Blog\.Api\.dll backup \/data\/backups/);
      assert.match(log, /run --rm --no-deps -T builder sh -euc .*PRAGMA integrity_check/s);
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

    it('si el stream de la base llega cortado, falla, no deja snapshot y borra igual la copia del volumen', async () => {
      const result = await sh('backup.sh', [], { FAKE_CUT_OUT: 'cat /data/backups/blog-' });

      assert.equal(result.code, 1);
      assert.match(result.stderr, /la base llegó incompleta desde \/data\/backups\/blog-20261126T030000Z\.db/);
      assert.deepEqual(await list(join(backups, 'daily')), []);
      assert.deepEqual(await list(live('backups')), []);
    });

    it('si la base copiada no pasa integrity_check, falla y no deja snapshot', async () => {
      await writeFile(live('blog.db'), `SQLite format 3\0${'x'.repeat(4096)}`);

      const result = await sh('backup.sh');

      assert.equal(result.code, 1);
      assert.match(result.stderr, /la base no pasa PRAGMA integrity_check/);
      assert.deepEqual(await list(join(backups, 'daily')), []);
      assert.deepEqual(await list(live('backups')), []);
    });

    it('al empezar borra las copias de la base de más de un día que quedaron en el volumen (una corrida cortada)', async () => {
      await writeFile(live('backups/blog-20261120T030000Z.db'), 'huérfana');
      await utimes(live('backups/blog-20261120T030000Z.db'), new Date('2026-11-20'), new Date('2026-11-20'));
      await writeFile(live('backups/blog-reciente.db'), 'de otra corrida en curso');

      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(await list(live('backups')), ['blog-reciente.db']);
    });

    it('media cortada a mitad del stream: no queda con su nombre final y la próxima corrida la copia entera', async () => {
      await sh('backup.sh');
      await writeFile(join(root, 'media', 'abc', '1024.webp'), 'otra imagen');
      await nextSecond();

      const cut = await sh('backup.sh', [], { FAKE_CUT_OUT: 'tar -cf - -T -' });

      assert.notEqual(cut.code, 0);
      assert.deepEqual(await list(join(backups, 'media', 'abc')), ['640.webp']);
      assert.equal((await list(join(backups, 'daily'))).length, 1, 'sin snapshot nuevo');
      await nextSecond();
      const next = await sh('backup.sh');
      assert.equal(next.code, 0, next.stderr);
      assert.equal(await readFile(join(backups, 'media', 'abc', '1024.webp'), 'utf8'), 'otra imagen');
    });

    it('repara la media que un backup anterior dejó truncada (mismo nombre, otro tamaño)', async () => {
      await mkdir(join(backups, 'media', 'abc'), { recursive: true });
      await writeFile(join(backups, 'media', 'abc', '640.webp'), 'ima');

      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.equal(await readFile(join(backups, 'media', 'abc', '640.webp'), 'utf8'), 'imagen');
      assert.match(result.stderr, /media: 1 archivos nuevos, 1 en total/);
    });
  });

  describe('backup.sh: copia remota con rclone', () => {
    const remoteEnv = (remote: string, remotes: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
      BACKUP_RCLONE_REMOTE: remote,
      FAKE_RCLONE_REMOTES: remotes,
      ...extra,
    });
    beforeEach(async () => {
      await writeFile(join(root, 'bin', 'rclone'), FAKE_RCLONE);
      await chmod(join(root, 'bin', 'rclone'), 0o755);
    });
    const sixOldDays = async (): Promise<void> => {
      for (let day = 20; day <= 25; day += 1) await mkdir(join(backups, 'daily', `202611${day}T030000Z`), { recursive: true });
    };

    it('con BACKUP_RCLONE_REMOTE pero sin rclone, avisa y el backup local queda', async () => {
      await rm(join(root, 'bin', 'rclone'));
      const result = await sh('backup.sh', [], { BACKUP_RCLONE_REMOTE: 'b2:bucket/blog' });

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /BACKUP_RCLONE_REMOTE está definido pero rclone no está instalado/);
    });

    it('rechaza un remote sin cifrar (el backup tiene el hash del admin y las claves): el local queda, no sube nada', async () => {
      const result = await sh('backup.sh', [], remoteEnv('b2:bucket/blog', 'b2: b2'));

      assert.equal(result.code, 1);
      assert.match(result.stderr, /b2:bucket\/blog no es un remote crypt de rclone/);
      assert.match(result.stderr, /BACKUP_ALLOW_PLAINTEXT=1/);
      assert.equal((await list(join(backups, 'daily'))).length, 1);
      assert.doesNotMatch(await calls(), /rclone (copy|sync)/);
    });

    it('con BACKUP_ALLOW_PLAINTEXT=1 acepta el remote sin cifrar', async () => {
      const result = await sh('backup.sh', [], remoteEnv('b2:bucket/blog', 'b2: b2', { BACKUP_ALLOW_PLAINTEXT: '1' }));

      assert.equal(result.code, 0, result.stderr);
      assert.match(await calls(), /rclone copy \S+ b2:bucket\/blog/);
    });

    it('sube con copy (nunca borra allá) y, con menos de 7 diarios locales, no aplica la retención remota', async () => {
      const result = await sh('backup.sh', [], remoteEnv('secreto:blog', 'b2: b2\nsecreto: crypt'));

      assert.equal(result.code, 0, result.stderr);
      const log = await calls();
      // Por tamaño: los archivos del backup nunca cambian (nombres por fecha o por hash), y comparar fechas falla en
      // remotos que las guardan con menos precisión (todo parecería cambiado y se volvería a subir).
      assert.match(log, new RegExp(`rclone copy ${backups} secreto:blog --size-only\n`));
      assert.doesNotMatch(log, /rclone (sync|delete|purge)/);
      assert.match(result.stderr, /retención remota salteada: hay 1 diarios locales y hacen falta 7/);
    });

    it('si el diario más nuevo no es el de esta corrida, no aplica la retención remota', async () => {
      await sixOldDays();
      await mkdir(join(backups, 'daily', '29991231T000000Z'));

      const result = await sh('backup.sh', [], remoteEnv('secreto:blog', 'secreto: crypt'));

      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(await calls(), /rclone (sync|delete|purge)/);
      assert.match(result.stderr, /retención remota salteada: el diario más nuevo \(29991231T000000Z\) no es el de esta corrida/);
    });

    it('con el set local completo, rota allá con tope de borrados y lo borrado va a deleted/<fecha>', async () => {
      await sixOldDays();

      const result = await sh('backup.sh', [], remoteEnv('secreto:blog', 'secreto: crypt', { FAKE_RCLONE_LSF: 'daily/\ndeleted/' }));

      assert.equal(result.code, 0, result.stderr);
      const stamp = (await list(join(backups, 'daily'))).at(-1)!;
      const log = await calls();
      for (const set of ['daily', 'weekly']) {
        assert.ok(
          log.includes(`rclone sync ${backups}/${set} secreto:blog/${set} --size-only --max-delete 4 --backup-dir secreto:blog/deleted/${stamp}/${set}\n`),
          set,
        );
      }
      // Las carpetas vacías se borran aparte y sin filtro de edad: con el filtro, --rmdirs ve vacías las que tienen
      // archivos nuevos (los filtrados) e intenta borrarlas.
      assert.match(log, /rclone delete secreto:blog\/deleted --min-age 30d\nrclone rmdirs secreto:blog\/deleted --leave-root\n/);
      assert.ok(log.indexOf('rclone copy') < log.indexOf('rclone sync'), 'primero sube, después rota');
    });

    it('sin carpeta deleted/ allá todavía, no intenta limpiarla', async () => {
      await sixOldDays();

      const result = await sh('backup.sh', [], remoteEnv('secreto:blog', 'secreto: crypt', { FAKE_RCLONE_LSF: 'daily/' }));

      assert.equal(result.code, 0, result.stderr);
      assert.match(await calls(), /rclone sync /);
      assert.doesNotMatch(await calls(), /rclone delete/);
    });
  });

  describe('restore.sh', () => {
    /** Hace un backup y deja el volumen distinto del snapshot (lo que el restore tiene que pisar). */
    const backupThenChange = async (): Promise<string> => {
      const result = await sh('backup.sh');
      assert.equal(result.code, 0, result.stderr);
      const snapshot = await latest();
      await rm(live('blog.db'));
      writeDb(live('blog.db'), 'base nueva');
      await writeFile(live('keys/key-1.xml'), '<key-nueva/>');
      await writeFile(live('keys/key-2.xml'), '<otra-key/>');
      await rm(join(root, 'calls'));
      return snapshot;
    };
    const preRestore = async (): Promise<string[]> => (await list(backups)).filter((name) => name.startsWith('pre-restore-'));

    it('sin --apply solo revisa (con integrity_check): no para nada ni toca la base', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot]);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /snapshot válido: base \d+ bytes \(integrity_check ok\), 1 claves, 1 archivos de media/);
      assert.match(result.stderr, /Simulación: no se cambió nada\. Con --apply:/);
      assert.equal(readDb(live('blog.db')), 'base nueva');
      const log = await calls();
      assert.match(log, /PRAGMA integrity_check/);
      assert.doesNotMatch(log, /init-permisos|stop|up -d|exec -T api|api -euc/);
      assert.deepEqual(await preRestore(), []);
    });

    it('--apply guarda antes una copia previa, reemplaza base y claves, descarta el -wal y agrega la media que falta', async () => {
      const snapshot = await backupThenChange();
      await writeFile(live('blog.db-wal'), 'wal de la base nueva');
      await rm(join(root, 'media', 'abc', '640.webp'));

      const result = await sh('restore.sh', [snapshot, '--apply']);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(readDb(live('blog.db')), 'base de prueba');
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('blog.db')), ['blog.db']);
      assert.deepEqual(await list(live('keys')), ['key-1.xml']);
      assert.equal(await readFile(live('keys/key-1.xml'), 'utf8'), '<key/>');
      assert.equal(await readFile(join(root, 'media', 'abc', '640.webp'), 'utf8'), 'imagen');
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('.')), [], 'sin temporales en el volumen');
      assert.deepEqual((await list(join(root, 'media'))).filter((name) => name.startsWith('.')), []);

      // La copia previa la hizo la API en marcha (copia consistente) y es un snapshot que restore.sh acepta.
      const [pre] = await preRestore();
      assert.match(pre!, /^pre-restore-\d{8}T\d{6}Z$/);
      assert.deepEqual(await list(join(backups, pre!)), ['blog.db', 'keys.tar']);
      assert.equal(readDb(join(backups, pre!, 'blog.db')), 'base nueva');
      assert.match(result.stderr, new RegExp(`copia previa: ${backups}/${pre}`));
      assert.deepEqual(await list(live('backups')), []);

      const log = await calls();
      const order = ['run --rm init-permisos', 'exec -T api sh -euc dotnet Blog.Api.dll backup', 'stop api builder', 'up -d --wait', 'exec -T builder node src/request-build.ts'];
      const positions = order.map((step) => log.indexOf(step));
      for (const [index, step] of order.entries()) assert.ok(positions[index]! >= 0, step);
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'en este orden');
    });

    it('con la API parada, la copia previa es la del volumen tal cual, con su -wal', async () => {
      const snapshot = await backupThenChange();
      await writeFile(live('blog.db-wal'), 'wal sin aplicar');

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_API_DOWN: '1' });

      assert.equal(result.code, 0, result.stderr);
      const [pre] = await preRestore();
      assert.deepEqual(await list(join(backups, pre!)), ['blog.db', 'blog.db-wal', 'keys.tar']);
      assert.equal(readDb(join(backups, pre!, 'blog.db')), 'base nueva');
      assert.equal(await readFile(join(backups, pre!, 'blog.db-wal'), 'utf8'), 'wal sin aplicar');
      assert.doesNotMatch(await calls(), /exec -T api/);
      assert.equal(readDb(live('blog.db')), 'base de prueba');
    });

    it('en un VPS nuevo (sin base ni claves) restaura sin copia previa', async () => {
      const snapshot = await backupThenChange();
      await rm(live('blog.db'));
      await rm(live('keys'), { recursive: true });

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_API_DOWN: '1' });

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /no hay base en el volumen: no hace falta copia previa/);
      assert.deepEqual(await preRestore(), []);
      assert.equal(readDb(live('blog.db')), 'base de prueba');
      assert.deepEqual(await list(live('keys')), ['key-1.xml']);
    });

    it('si la base llega cortada al volumen, falla antes de parar nada y la base actual queda intacta', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_CUT_IN: 'cat >/data/.restoring/blog.db' });

      assert.equal(result.code, 1);
      assert.match(result.stderr, /blog\.db llegó incompleta a \/data\/\.restoring\/blog\.db/);
      assert.equal(readDb(live('blog.db')), 'base nueva');
      assert.deepEqual(await list(live('keys')), ['key-1.xml', 'key-2.xml']);
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('.')), [], 'sin temporales en el volumen');
      assert.doesNotMatch(await calls(), /stop api builder/);
    });

    it('si la media llega cortada, falla antes de parar nada y no deja archivos a medias en /media', async () => {
      const snapshot = await backupThenChange();
      await rm(join(root, 'media', 'abc', '640.webp'));

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_CUT_IN: '-C /media/.restoring -xf -' });

      assert.equal(result.code, 1);
      assert.deepEqual(await list(join(root, 'media', 'abc')), ['1024.webp.0f.tmp']);
      assert.deepEqual((await list(join(root, 'media'))).filter((name) => name.startsWith('.')), []);
      assert.equal(readDb(live('blog.db')), 'base nueva');
      assert.doesNotMatch(await calls(), /stop api builder/);
    });

    it('si después del cambio la API no da sano, vuelve a poner la copia previa, levanta todo y dice dónde está', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_UP_FAIL: '1' });

      assert.equal(result.code, 1);
      const [pre] = await preRestore();
      assert.match(result.stderr, /container blog-api-1 is unhealthy/);
      assert.match(result.stderr, new RegExp(`el restore falló: se volvió a poner la copia previa ${backups}/${pre}`));
      assert.equal(readDb(live('blog.db')), 'base nueva');
      assert.deepEqual(await list(live('keys')), ['key-1.xml', 'key-2.xml']);
      assert.equal(await readFile(live('keys/key-1.xml'), 'utf8'), '<key-nueva/>');
      assert.equal((await calls()).match(/up -d --wait/g)?.length, 2, 'levanta todo de nuevo');
    });

    it('rechaza un snapshot con la base dañada (integrity_check) sin tocar nada', async () => {
      const snapshot = await backupThenChange();
      await writeFile(join(snapshot, 'blog.db'), `SQLite format 3\0${'x'.repeat(4096)}`);

      const result = await sh('restore.sh', [snapshot, '--apply']);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /blog\.db no pasa PRAGMA integrity_check/);
      assert.equal(readDb(live('blog.db')), 'base nueva');
      assert.doesNotMatch(await calls(), /init-permisos|stop api builder/);
    });

    it('sin snapshot explica el uso; con uno inválido no hace nada', async () => {
      assert.deepEqual(await sh('restore.sh'), { code: 2, stdout: '', stderr: 'Uso: sh restore.sh <carpeta del snapshot> [--apply]\n' });
      const result = await sh('restore.sh', [join(backups, 'nada'), '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /nada\/blog\.db no existe o no es una base SQLite/);
      await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
    });
  });
});
