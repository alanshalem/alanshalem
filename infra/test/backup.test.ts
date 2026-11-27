import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// backup.sh and restore.sh with a fake `docker` on the PATH: each `docker compose exec|run … sh -euc SCRIPT` runs
// SCRIPT here, with /data and /media pointing to temporary folders; `dotnet Blog.Api.dll backup` copies the test
// database (like the real command, it prints the path) and the integrity check runs with this machine's node
// (node:sqlite). The FAKE_* variables simulate the failures: the API down, a healthcheck that never reports healthy, a
// connection cut halfway through the stream. The test with real Docker (a backup with the site running, deleting the volumes and
// restoring) is run by hand with the local production copy. The scripts are for the VPS (Linux): skipped on Windows.
const skip = process.platform === 'win32' ? 'the backup scripts run on Linux (on Windows, test them in Docker)' : false;
const script = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url));

const FAKE_DOCKER = String.raw`#!/bin/sh
echo "$*" >>"$FAKE_ROOT/calls"
shift                                   # compose
env_file=
[ "$1" = --env-file ] && { env_file=$2; shift 2; }
# The stack this call targets, resolved like compose: COMPOSE_PROJECT_NAME and COMPOSE_FILE from the environment win,
# then the ones in the --env-file (relative to the working directory, optional double quotes), then the defaults.
from_env_file() { [ -f "$env_file" ] && sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed 's/^"\(.*\)"$/\1/'; }
project=$COMPOSE_PROJECT_NAME; [ -n "$project" ] || project=$(from_env_file COMPOSE_PROJECT_NAME); [ -n "$project" ] || project='<directory>'
files=$COMPOSE_FILE; [ -n "$files" ] || files=$(from_env_file COMPOSE_FILE); [ -n "$files" ] || files=docker-compose.yml
echo "$PWD $project $files $1" >>"$FAKE_ROOT/targets"
case $1 in
ps) [ -n "$FAKE_API_DOWN" ] || echo fake-api-container; exit 0 ;;
up)
	if [ -n "$FAKE_UP_FAIL" ] && [ ! -e "$FAKE_ROOT/up-failed" ]; then
		: >"$FAKE_ROOT/up-failed"
		echo "container blog-api-1 is unhealthy" >&2
		exit 1
	fi
	exit 0 ;;
stop)
	if [ -n "$FAKE_STOP_FAIL" ] && [ -e "$FAKE_ROOT/up-failed" ]; then
		echo "Cannot connect to the Docker daemon" >&2
		exit 1
	fi
	exit 0 ;;
esac
case " $* " in *' -euc '*) ;; *) exit 0 ;; esac      # stop, init-permissions, request-build: only recorded
for last; do :; done                    # the script is the last argument
mapped=$(printf %s "$last" | sed "s#/data#$FAKE_ROOT/data#g; s#/media#$FAKE_ROOT/media#g")
run() { PATH="$FAKE_ROOT/bin:$PATH" sh -euc "$mapped"; }
# The connection is cut halfway through the stream and docker still exits with 0 (the worst case: nobody notices).
if [ -n "$FAKE_CUT_IN" ] && printf %s "$last" | grep -qF -- "$FAKE_CUT_IN"; then
	head -c "$FAKE_CUT_BYTES" | run
elif [ -n "$FAKE_CUT_OUT" ] && printf %s "$last" | grep -qF -- "$FAKE_CUT_OUT"; then
	run | head -c "$FAKE_CUT_BYTES"
else
	run
fi
`;

// The API's backup failure message (`Backup failed: {exception.Message}`), with a test exception message.
const FAKE_DOTNET = String.raw`#!/bin/sh
[ "$1 $2" = "Blog.Api.dll backup" ] || exit 64
[ -z "$FAKE_BACKUP_FAIL" ] || { echo "Backup failed: test failure" >&2; exit 1; }
cp "$FAKE_ROOT/data/blog.db" "$3/blog-20261126T030000Z.db"
echo "$3/blog-20261126T030000Z.db" | sed "s#^$FAKE_ROOT##"     # the path as the container sees it
`;

// Fake rclone: records every call; listremotes and lsf answer whatever the test says.
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

/** A real SQLite database (the integrity check opens it) with a single value inside. */
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

describe('backup.sh and restore.sh', { skip }, () => {
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
  // Two backups in the same second would have the same name: wait between runs.
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
    writeDb(live('blog.db'), 'test database');
    await writeFile(live('keys/key-1.xml'), '<key/>');
    await writeFile(join(root, 'media', 'abc', '640.webp'), 'image');
    await writeFile(join(root, 'media', 'abc', '1024.webp.0f.tmp'), 'upload in progress');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('backup.sh', () => {
    it('copies the database and the media (without the .tmp files; never the session keys), and leaves no database copy on the volume', async () => {
      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const [stamp] = await list(join(backups, 'daily'));
      assert.match(stamp!, /^\d{8}T\d{6}Z$/);
      assert.deepEqual(await list(join(backups, 'daily', stamp!)), ['blog.db'], 'no session keys');
      assert.equal(readDb(join(backups, 'daily', stamp!, 'blog.db')), 'test database');
      assert.deepEqual(await list(join(backups, 'media', 'abc')), ['640.webp']);
      assert.deepEqual(await list(live('backups')), []);
      assert.deepEqual(await list(join(backups, 'weekly')), [stamp]);
      assert.match(result.stderr, /media: 1 new files, 1 in total/);
      assert.match(result.stderr, /no BACKUP_RCLONE_REMOTE: the backup stays only in /);
      // The API's `backup` command, inside its running container; and the database checked with integrity_check.
      const log = await calls();
      assert.match(log, /exec -T api sh -euc dotnet Blog\.Api\.dll backup \/data\/backups/);
      assert.match(log, /run --rm --no-deps -T builder sh -euc .*PRAGMA integrity_check/s);
    });

    it('the second time copies only the new media', async () => {
      await sh('backup.sh');
      await writeFile(join(root, 'media', 'abc', '1024.webp'), 'another');
      await nextSecond();

      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /media: 1 new files, 2 in total/);
      assert.deepEqual(await list(join(backups, 'media', 'abc')), ['1024.webp', '640.webp']);
    });

    it('rotates: the 7 newest daily and 4 newest weekly snapshots stay; one weekly per week', async () => {
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
      assert.equal(weekly[3], daily[6], "the new weekly is today's daily (there was none from the last 7 days)");

      // Another run the same week: a new daily, no new weekly.
      await nextSecond();
      assert.equal((await sh('backup.sh')).code, 0);
      assert.deepEqual(await list(join(backups, 'weekly')), weekly);
    });

    it('if the API cannot copy the database, it fails and leaves no half-made snapshot', async () => {
      const result = await sh('backup.sh', [], { FAKE_BACKUP_FAIL: '1' });

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Backup failed: test failure/);
      assert.deepEqual(await list(join(backups, 'daily')), []);
    });

    it('if the database stream arrives cut, it fails, leaves no snapshot and still deletes the copy on the volume', async () => {
      const result = await sh('backup.sh', [], { FAKE_CUT_OUT: 'cat /data/backups/blog-' });

      assert.equal(result.code, 1);
      assert.match(result.stderr, /the database arrived incomplete from \/data\/backups\/blog-20261126T030000Z\.db/);
      assert.deepEqual(await list(join(backups, 'daily')), []);
      assert.deepEqual(await list(live('backups')), []);
    });

    it('if the copied database does not pass integrity_check, it fails and leaves no snapshot', async () => {
      await writeFile(live('blog.db'), `SQLite format 3\0${'x'.repeat(4096)}`);

      const result = await sh('backup.sh');

      assert.equal(result.code, 1);
      assert.match(result.stderr, /the database does not pass PRAGMA integrity_check/);
      assert.deepEqual(await list(join(backups, 'daily')), []);
      assert.deepEqual(await list(live('backups')), []);
    });

    it('on start it deletes the database copies older than a day left on the volume (a killed run)', async () => {
      await writeFile(live('backups/blog-20261120T030000Z.db'), 'orphan');
      await utimes(live('backups/blog-20261120T030000Z.db'), new Date('2026-11-20'), new Date('2026-11-20'));
      await writeFile(live('backups/blog-recent.db'), 'from another run in progress');

      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(await list(live('backups')), ['blog-recent.db']);
    });

    it('media cut halfway through the stream: it does not keep its final name and the next run copies it whole', async () => {
      await sh('backup.sh');
      await writeFile(join(root, 'media', 'abc', '1024.webp'), 'another image');
      await nextSecond();

      const cut = await sh('backup.sh', [], { FAKE_CUT_OUT: 'tar -cf - -T -' });

      assert.notEqual(cut.code, 0);
      assert.deepEqual(await list(join(backups, 'media', 'abc')), ['640.webp']);
      assert.equal((await list(join(backups, 'daily'))).length, 1, 'no new snapshot');
      await nextSecond();
      const next = await sh('backup.sh');
      assert.equal(next.code, 0, next.stderr);
      assert.equal(await readFile(join(backups, 'media', 'abc', '1024.webp'), 'utf8'), 'another image');
    });

    it('repairs media that a previous backup left truncated (same name, another size)', async () => {
      await mkdir(join(backups, 'media', 'abc'), { recursive: true });
      await writeFile(join(backups, 'media', 'abc', '640.webp'), 'ima');

      const result = await sh('backup.sh');

      assert.equal(result.code, 0, result.stderr);
      assert.equal(await readFile(join(backups, 'media', 'abc', '640.webp'), 'utf8'), 'image');
      assert.match(result.stderr, /media: 1 new files, 1 in total/);
    });
  });

  describe('backup.sh: remote copy with rclone', () => {
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

    it('with BACKUP_RCLONE_REMOTE but without rclone, it warns and the local backup stays', async () => {
      await rm(join(root, 'bin', 'rclone'));
      const result = await sh('backup.sh', [], { BACKUP_RCLONE_REMOTE: 'b2:bucket/blog' });

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /BACKUP_RCLONE_REMOTE is set but rclone is not installed/);
    });

    it('rejects an unencrypted remote (the backup holds the admin hash and the drafts): the local one stays, nothing is uploaded', async () => {
      const result = await sh('backup.sh', [], remoteEnv('b2:bucket/blog', 'b2: b2'));

      assert.equal(result.code, 1);
      assert.match(result.stderr, /b2:bucket\/blog is not an rclone crypt remote/);
      assert.match(result.stderr, /BACKUP_ALLOW_PLAINTEXT=1/);
      assert.equal((await list(join(backups, 'daily'))).length, 1);
      assert.doesNotMatch(await calls(), /rclone (copy|sync)/);
    });

    it('with BACKUP_ALLOW_PLAINTEXT=1 it accepts the unencrypted remote', async () => {
      const result = await sh('backup.sh', [], remoteEnv('b2:bucket/blog', 'b2: b2', { BACKUP_ALLOW_PLAINTEXT: '1' }));

      assert.equal(result.code, 0, result.stderr);
      assert.match(await calls(), /rclone copy \S+ b2:bucket\/blog/);
    });

    it('uploads with copy (never deletes there) and, with fewer than 7 local dailies, does not apply the remote retention', async () => {
      const result = await sh('backup.sh', [], remoteEnv('secret:blog', 'b2: b2\nsecret: crypt'));

      assert.equal(result.code, 0, result.stderr);
      const log = await calls();
      // By size: backup files never change (named by date or by hash), and comparing dates fails on remotes that store
      // them with less precision (everything would look changed and be uploaded again).
      assert.match(log, new RegExp(`rclone copy ${backups} secret:blog --size-only\n`));
      assert.doesNotMatch(log, /rclone (sync|delete|purge)/);
      assert.match(result.stderr, /remote retention skipped: there are 1 local daily snapshots and 7 are needed/);
    });

    it("if the newest daily is not this run's, it does not apply the remote retention", async () => {
      await sixOldDays();
      await mkdir(join(backups, 'daily', '29991231T000000Z'));

      const result = await sh('backup.sh', [], remoteEnv('secret:blog', 'secret: crypt'));

      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(await calls(), /rclone (sync|delete|purge)/);
      assert.match(result.stderr, /remote retention skipped: the newest daily snapshot \(29991231T000000Z\) is not this run's/);
    });

    it('with the complete local set, it rotates there with a deletion cap and what is deleted goes to deleted/<date>', async () => {
      await sixOldDays();

      const result = await sh('backup.sh', [], remoteEnv('secret:blog', 'secret: crypt', { FAKE_RCLONE_LSF: 'daily/\ndeleted/' }));

      assert.equal(result.code, 0, result.stderr);
      const stamp = (await list(join(backups, 'daily'))).at(-1)!;
      const log = await calls();
      for (const set of ['daily', 'weekly']) {
        assert.ok(
          log.includes(`rclone sync ${backups}/${set} secret:blog/${set} --size-only --max-delete 2 --backup-dir secret:blog/deleted/${stamp}/${set}\n`),
          set,
        );
      }
      // Empty folders are deleted separately and without an age filter: with the filter, --rmdirs sees folders with new
      // files (the filtered ones) as empty and tries to delete them.
      assert.match(log, /rclone delete secret:blog\/deleted --min-age 30d\nrclone rmdirs secret:blog\/deleted --leave-root\n/);
      assert.ok(log.indexOf('rclone copy') < log.indexOf('rclone sync'), 'uploads first, rotates afterwards');
    });

    it('without a deleted/ folder there yet, it does not try to clean it', async () => {
      await sixOldDays();

      const result = await sh('backup.sh', [], remoteEnv('secret:blog', 'secret: crypt', { FAKE_RCLONE_LSF: 'daily/' }));

      assert.equal(result.code, 0, result.stderr);
      assert.match(await calls(), /rclone sync /);
      assert.doesNotMatch(await calls(), /rclone delete/);
    });
  });

  describe('under Dokploy (cron runs the scripts from the deploy folder, with no COMPOSE_* of its own)', () => {
    // Dokploy writes infra/.env next to the compose path on every deploy: APP_NAME and COMPOSE_PROJECT_NAME first, then
    // the Environment tab. The values may arrive unquoted or as KEY="value" (docker-and-deploy skill, A2 notes).
    for (const quote of ['', '"']) {
      it(`backup.sh and restore.sh --apply target the project and files of that .env (values ${quote ? 'quoted' : 'unquoted'})`, async () => {
        const infra = join(root, 'etc', 'dokploy', 'compose', 'alanshalem-staging-x1y2z3', 'code', 'infra');
        await mkdir(infra, { recursive: true });
        for (const name of ['backup.sh', 'restore.sh', 'backup-common.sh']) await writeFile(join(infra, name), await readFile(script(name)));
        await writeFile(
          join(infra, '.env'),
          [
            'APP_NAME=alanshalem-staging-x1y2z3',
            'COMPOSE_PROJECT_NAME=alanshalem-staging-x1y2z3',
            `SITE_ADDRESS=${quote}:80${quote}`,
            `SITE_ENV=${quote}staging${quote}`,
            `COMPOSE_FILE=${quote}docker-compose.yml:compose.dokploy.yml${quote}`,
            'DOCKER_CONFIG=/root/.docker/config.json',
          ].join('\n'),
        );
        const cron = { COMPOSE_PROJECT_NAME: undefined, COMPOSE_FILE: undefined, ENV_FILE: undefined };
        const run = (name: string, args: string[] = []): Promise<Run> =>
          new Promise((resolve) => {
            execFile('sh', [join(infra, name), ...args], { cwd: root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FAKE_ROOT: root, FAKE_CUT_BYTES: '515', BACKUP_DIR: backups, ...cron } }, (error, stdout, stderr) =>
              resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
            );
          });

        const backup = await run('backup.sh');
        assert.equal(backup.code, 0, backup.stderr);
        const restore = await run('restore.sh', [await latest(), '--apply']);
        assert.equal(restore.code, 0, restore.stderr);

        const targets = (await readFile(join(root, 'targets'), 'utf8')).trim().split('\n');
        const subcommands = new Set(targets.map((line) => line.split(' ').at(-1)));
        for (const step of ['exec', 'run', 'stop', 'up']) assert.ok(subcommands.has(step), `no compose ${step} call`);
        for (const line of targets) {
          assert.match(line, new RegExp(`^${infra} alanshalem-staging-x1y2z3 docker-compose\\.yml:compose\\.dokploy\\.yml \\w+$`), line);
        }
        // Only the env file names the stack: the scripts pass no project or file of their own.
        for (const call of (await calls()).trim().split('\n')) {
          if (!call.startsWith('compose ')) continue;
          assert.match(call, /^compose --env-file \.env /, call);
          assert.doesNotMatch(call.split(' -euc ')[0]!, / (-p|-f|--project-name|--file) /, call);
        }
      });
    }
  });

  describe('restore.sh', () => {
    /** Makes a backup and leaves the volume different from the snapshot (what the restore has to overwrite). */
    const backupThenChange = async (): Promise<string> => {
      const result = await sh('backup.sh');
      assert.equal(result.code, 0, result.stderr);
      const snapshot = await latest();
      await rm(live('blog.db'));
      writeDb(live('blog.db'), 'new database');
      await writeFile(live('keys/key-1.xml'), '<new-key/>');
      await writeFile(live('keys/key-2.xml'), '<another-key/>');
      await rm(join(root, 'calls'));
      return snapshot;
    };
    /** No keys on the volume: the API starts with new ones and no cookie issued before the restore is valid. */
    const noKeys = async (): Promise<void> => {
      await assert.rejects(readdir(live('keys')), { code: 'ENOENT' });
    };
    const preRestore = async (): Promise<string[]> => (await list(backups)).filter((name) => name.startsWith('pre-restore-'));

    it('without --apply it only checks (with integrity_check): it stops nothing and does not touch the database', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot]);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /valid snapshot: database \d+ bytes \(integrity_check ok\), 1 media files/);
      assert.match(result.stderr, /Dry run: nothing was changed\. With --apply:/);
      assert.equal(readDb(live('blog.db')), 'new database');
      const log = await calls();
      assert.match(log, /PRAGMA integrity_check/);
      assert.doesNotMatch(log, /init-permissions|stop|up -d|exec -T api|api -euc/);
      assert.deepEqual(await preRestore(), []);
    });

    it('--apply first saves a previous copy, replaces the database, discards the -wal and adds the missing media', async () => {
      const snapshot = await backupThenChange();
      await writeFile(live('blog.db-wal'), 'wal of the new database');
      await rm(join(root, 'media', 'abc', '640.webp'));

      const result = await sh('restore.sh', [snapshot, '--apply']);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(readDb(live('blog.db')), 'test database');
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('blog.db')), ['blog.db']);
      await noKeys();
      assert.equal(await readFile(join(root, 'media', 'abc', '640.webp'), 'utf8'), 'image');
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('.')), [], 'no temporary folders on the volume');
      assert.deepEqual((await list(join(root, 'media'))).filter((name) => name.startsWith('.')), []);

      // The previous copy was made by the running API (a consistent copy) and is a snapshot restore.sh accepts.
      const [pre] = await preRestore();
      assert.match(pre!, /^pre-restore-\d{8}T\d{6}Z$/);
      assert.deepEqual(await list(join(backups, pre!)), ['blog.db']);
      assert.equal(readDb(join(backups, pre!, 'blog.db')), 'new database');
      assert.match(result.stderr, new RegExp(`previous copy: ${backups}/${pre}`));
      assert.deepEqual(await list(live('backups')), []);

      const log = await calls();
      const order = ['run --rm init-permissions', 'exec -T api sh -euc dotnet Blog.Api.dll backup', 'stop api builder', 'up -d --wait', 'exec -T builder node src/request-build.ts'];
      const positions = order.map((step) => log.indexOf(step));
      for (const [index, step] of order.entries()) assert.ok(positions[index]! >= 0, step);
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'in this order');
    });

    it('--apply does not bring revoked sessions back: neither the snapshot nor the volume keeps its session keys', async () => {
      // A backup predates a logout: if it brought its keys (and its session epoch), a cookie revoked later would be
      // valid again. With new keys, every cookie issued before the restore stops being valid and the admin signs in
      // again.
      const snapshot = await backupThenChange();
      // Snapshots from before the keys left the backup carry keys.tar: they are accepted and their keys ignored.
      await writeFile(join(snapshot, 'keys.tar'), 'old keys');
      await mkdir(join(snapshot, 'keys'));
      await writeFile(join(snapshot, 'keys', 'key-0.xml'), '<old-key/>');
      assert.deepEqual(await list(live('keys')), ['key-1.xml', 'key-2.xml'], 'the volume had keys before');

      const result = await sh('restore.sh', [snapshot, '--apply']);

      assert.equal(result.code, 0, result.stderr);
      await noKeys();
      assert.match(result.stderr, /new session keys: the admin has to sign in again/);
    });

    it('with the API stopped, the previous copy is the volume as it is, with its -wal', async () => {
      const snapshot = await backupThenChange();
      await writeFile(live('blog.db-wal'), 'unapplied wal');

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_API_DOWN: '1' });

      assert.equal(result.code, 0, result.stderr);
      const [pre] = await preRestore();
      assert.deepEqual(await list(join(backups, pre!)), ['blog.db', 'blog.db-wal']);
      assert.equal(readDb(join(backups, pre!, 'blog.db')), 'new database');
      assert.equal(await readFile(join(backups, pre!, 'blog.db-wal'), 'utf8'), 'unapplied wal');
      assert.doesNotMatch(await calls(), /exec -T api/);
      assert.equal(readDb(live('blog.db')), 'test database');
    });

    it('on a new VPS (no database or keys) it restores without a previous copy', async () => {
      const snapshot = await backupThenChange();
      await rm(live('blog.db'));
      await rm(live('keys'), { recursive: true });

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_API_DOWN: '1' });

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /no database on the volume: no previous copy needed/);
      assert.deepEqual(await preRestore(), []);
      assert.equal(readDb(live('blog.db')), 'test database');
      await noKeys();
    });

    it('if the database arrives cut on the volume, it fails before stopping anything and the current database stays intact', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_CUT_IN: 'cat >/data/.restoring/blog.db' });

      assert.equal(result.code, 1);
      assert.match(result.stderr, /blog\.db arrived incomplete at \/data\/\.restoring\/blog\.db/);
      assert.equal(readDb(live('blog.db')), 'new database');
      assert.deepEqual(await list(live('keys')), ['key-1.xml', 'key-2.xml']);
      assert.deepEqual((await list(live(''))).filter((name) => name.startsWith('.')), [], 'no temporary folders on the volume');
      assert.doesNotMatch(await calls(), /stop api builder/);
    });

    it('if the media arrives cut, it fails before stopping anything and leaves no half-made files in /media', async () => {
      const snapshot = await backupThenChange();
      await rm(join(root, 'media', 'abc', '640.webp'));

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_CUT_IN: '-C /media/.restoring -xf -' });

      assert.equal(result.code, 1);
      assert.deepEqual(await list(join(root, 'media', 'abc')), ['1024.webp.0f.tmp']);
      assert.deepEqual((await list(join(root, 'media'))).filter((name) => name.startsWith('.')), []);
      assert.equal(readDb(live('blog.db')), 'new database');
      assert.doesNotMatch(await calls(), /stop api builder/);
    });

    it('if the API is not healthy after the swap, it puts the previous copy back, starts everything and says where it is', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_UP_FAIL: '1' });

      assert.equal(result.code, 1);
      const [pre] = await preRestore();
      assert.match(result.stderr, /container blog-api-1 is unhealthy/);
      assert.match(result.stderr, new RegExp(`the restore failed: the previous copy ${backups}/${pre} was put back`));
      assert.equal(readDb(live('blog.db')), 'new database');
      await noKeys();
      assert.equal((await calls()).match(/up -d --wait/g)?.length, 2, 'starts everything again');
    });

    it('if up --wait fails with the API already started, it stops api and builder before putting the previous copy back', async () => {
      // --wait can fail because of the builder or Caddy with the API already running: swapping the database underneath
      // it would leave it serving the restored one (deleted files open) and lose whatever is written until it restarts.
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_UP_FAIL: '1' });

      assert.equal(result.code, 1);
      const log = (await calls()).split('\n');
      const firstUp = log.findIndex((line) => line.includes('up -d --wait'));
      const stop = log.findIndex((line, index) => index > firstUp && line.includes('stop api builder'));
      const swap = log.findIndex((line, index) => index > firstUp && line.includes('mv .restoring/blog.db blog.db'));
      assert.ok(firstUp >= 0 && stop > firstUp && stop < swap, 'the rollback never swaps the database with the API running');
      assert.equal(readDb(live('blog.db')), 'new database');
    });

    it('if the rollback cannot stop the API, it does not swap the database and says how to finish by hand', async () => {
      const snapshot = await backupThenChange();

      const result = await sh('restore.sh', [snapshot, '--apply'], { FAKE_UP_FAIL: '1', FAKE_STOP_FAIL: '1' });

      assert.equal(result.code, 1);
      const [pre] = await preRestore();
      assert.match(result.stderr, new RegExp(`the previous copy could not be put back automatically\\. By hand: sh restore\\.sh ${backups}/${pre} --apply`));
      assert.equal((await calls()).match(/mv \.restoring\/blog\.db blog\.db/g)?.length, 1, "a single database swap: the restore's");
      assert.equal(readDb(live('blog.db')), 'test database');
    });

    it('rejects a snapshot with a damaged database (integrity_check) without touching anything', async () => {
      const snapshot = await backupThenChange();
      await writeFile(join(snapshot, 'blog.db'), `SQLite format 3\0${'x'.repeat(4096)}`);

      const result = await sh('restore.sh', [snapshot, '--apply']);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /blog\.db does not pass PRAGMA integrity_check/);
      assert.equal(readDb(live('blog.db')), 'new database');
      assert.doesNotMatch(await calls(), /init-permissions|stop api builder/);
    });

    it('without a snapshot it explains the usage; with an invalid one it does nothing', async () => {
      assert.deepEqual(await sh('restore.sh'), { code: 2, stdout: '', stderr: 'Usage: sh restore.sh <snapshot folder> [--apply]\n' });
      const result = await sh('restore.sh', [join(backups, 'nothing'), '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /nothing\/blog\.db does not exist or is not a SQLite database/);
      await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
    });
  });
});
