#!/bin/sh
# Restores an infra/backup.sh snapshot: database and media, with new session keys (the admin signs in again: a snapshot
# predates a logout and must not bring a revoked session back). Without --apply it only checks the snapshot and shows
# what it would do (it touches nothing). Configuration: infra/backup-common.sh (the same variables as the backup).
#
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z            check
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z --apply    restore
#
# From the remote copy (a new VPS): first `rclone copy "$BACKUP_RCLONE_REMOTE" "$BACKUP_DIR"`, then the above.
#
# Steps with --apply. What can fail halfway (fetching files, checking they arrived whole) is done before stopping
# anything; once the blog is stopped, only renames inside each volume and starting it again remain:
#   1. Prepares the volumes (init-permissions: creates them if they do not exist and sets the right owner).
#   2. Copies the database and the media the volume is missing to temporary folders (.restoring) and checks that they
#      arrived whole (CRC and size). Nothing has been touched so far.
#   3. Saves what is there today in BACKUP_DIR/pre-restore-<UTC> (with the API running, with its backup command;
#      stopped, the volume as it is). It is a snapshot like any other: it can be restored with this same script.
#   4. Stops the API and the builder (Caddy keeps serving the published site), swaps the database and media for the new
#      ones and deletes the session keys.
#   5. Starts everything, waits for the healthchecks to report healthy and requests a build with the restored database.
#   If anything fails from step 4 on, it puts the previous copy back, starts everything and says where it is.

# shellcheck source=infra/backup-common.sh
. "$(dirname "$0")/backup-common.sh"

is_sqlite() {
	[ "$(dd if="$1" bs=15 count=1 2>/dev/null)" = "SQLite format 3" ]
}

api_running() {
	[ -n "$(compose ps --status running -q api)" ]
}

snapshot=${1:-}
[ -n "$snapshot" ] || {
	echo "Usage: sh restore.sh <snapshot folder> [--apply]" >&2
	exit 2
}
apply=false
if [ "${2:-}" = --apply ]; then apply=true; fi

snapshot=$(absolute "$snapshot")

# ---------- Check (always) ----------
is_sqlite "$snapshot/blog.db" || die "$snapshot/blog.db does not exist or is not a SQLite database"
[ -d "$BACKUP_DIR/media" ] || die "$BACKUP_DIR/media is missing"
verify_db "$snapshot" || die "$snapshot/blog.db does not pass PRAGMA integrity_check"
log "valid snapshot: database $(wc -c <"$snapshot/blog.db" | tr -d ' ') bytes (integrity_check ok), $(backup_sizes "$BACKUP_DIR/media" | wc -l | tr -d ' ') media files in $BACKUP_DIR/media"

if [ "$apply" = false ]; then
	cat >&2 <<EOF
Dry run: nothing was changed. With --apply:
  1. init-permissions prepares the volumes
  2. the database and the missing media are copied to temporary folders on the volumes, and checked to have arrived
     whole
  3. what is there today is saved in $BACKUP_DIR/pre-restore-<UTC>
  4. api and builder are stopped (Caddy keeps serving the published site) and everything is swapped for the restored
     copy, with new session keys: the admin signs in again
  5. everything is started, the healthchecks are awaited and a site build is requested
  If anything fails from step 4 on, the previous copy is put back and everything is started.
EOF
	exit 0
fi

# ---------- Restore ----------
# The functions here return their result instead of stopping (set -e does not stop inside an `if` or an `&&`, and the
# rollback uses them that way): every step that fails ends with `|| return 1`.

# Copies the local file $1 to the volume as $2 and checks, in the same container, that it arrived whole.
push() {
	[ "$(api_sh run "cat >$2; cksum <$2" <"$1" | crc)" = "$(cksum <"$1" | crc)" ] || {
		log "${1##*/} arrived incomplete at $2"
		return 1
	}
}

# Database (with its -wal, if the snapshot has one) from snapshot $1 to /data/.restoring, ready for the swap.
stage_data() {
	api_sh run 'rm -rf /data/.restoring; mkdir /data/.restoring' || return 1
	for file in blog.db blog.db-wal; do
		if [ -f "$1/$file" ]; then push "$1/$file" "/data/.restoring/$file" || return 1; fi
	done
}

# The backup media the volume lacks (or has with another size) to /media/.restoring, checked by size.
stage_media() {
	volume_sizes run >"$work/media-volume.txt" || return 1
	backup_sizes "$BACKUP_DIR/media" >"$work/media-backup.txt" || return 1
	LC_ALL=C comm -13 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-missing.txt" || return 1
	if [ -s "$work/media-missing.txt" ]; then
		[ "$(paths <"$work/media-missing.txt" | (cd "$BACKUP_DIR/media" && tar -cf - -T -) |
			api_sh run "rm -rf /media/.restoring; mkdir /media/.restoring; tar -C /media/.restoring -xf -; set -- /media/.restoring; $SIZES")" = "$(cat "$work/media-missing.txt")" ] || {
			log "the media arrived incomplete at /media/.restoring"
			return 1
		}
	fi
	log "media: $(wc -l <"$work/media-missing.txt" | tr -d ' ') files to add"
}

# What the volume has today ($1 = exec: the running API makes the consistent copy; run: with the API stopped it is
# copied as it is, with the -wal if there is one, because it may hold changes not yet written to the database).
save_current() {
	# shellcheck disable=SC2016 # expanded in the container
	present=$(api_sh run 'cd /data; for f in blog.db blog.db-wal; do [ ! -e "$f" ] || echo "$f"; done') || return 1
	if ! printf '%s\n' "$present" | grep -qx blog.db; then
		log "no database on the volume: no previous copy needed"
		saved=true
		return
	fi
	partial="$BACKUP_DIR/.pre-restore.partial"
	rm -rf "$partial"
	mkdir -p "$partial" || return 1
	if [ "$1" = exec ]; then
		api_backup "$partial/blog.db" || return 1
	else
		for file in blog.db blog.db-wal; do
			if printf '%s\n' "$present" | grep -qx "$file"; then
				pull run "/data/$file" "$partial/$file" || {
					log "$file arrived incomplete from the volume"
					return 1
				}
			fi
		done
	fi
	target="$BACKUP_DIR/pre-restore-$(utc_stamp)"
	mv "$partial" "$target" || return 1
	pre=$target
	saved=true
	log "previous copy: $pre"
}

# The swap, with the API stopped: renames inside each volume, nothing that can arrive halfway. The session keys are
# deleted (the API creates new ones on start): no cookie issued before is valid, not even one that a logout had already
# revoked and that the restored database's session epoch would accept again. It also applies when putting the previous
# copy back. Caddy (another user) must be able to read the media: tar extracts it with the backup's permissions (owner
# only) and they are given back here.
INSTALL="cd /data
rm -f blog.db-wal blog.db-shm
mv .restoring/blog.db blog.db
if [ -f .restoring/blog.db-wal ]; then mv .restoring/blog.db-wal blog.db-wal; fi
rm -rf keys .restoring
if [ -d /media/.restoring ]; then
	(set -- /media/.restoring /media; $MOVE_FILES)
	rm -rf /media/.restoring
	find /media ! -perm -a+r -exec chmod a+rX {} +
fi"

rollback() {
	if [ "$swapped" = true ] && [ -n "$pre" ]; then
		# Stop first: if step 5 failed, the API may be running with the restored database open, and swapping it
		# underneath would leave it serving with deleted files (whatever is written is lost on restart).
		if compose stop api builder && stage_data "$pre" && api_sh run "$INSTALL"; then
			log "the restore failed: the previous copy $pre was put back"
		else
			log "WARNING: the restore failed and the previous copy could not be put back automatically. By hand: sh restore.sh $pre --apply"
		fi
	elif [ "$swapped" = true ]; then
		log "the restore failed: there was no database before, so the restored one stays"
	fi
	compose up -d --wait || log "WARNING: the blog did not come up healthy: check with docker compose ps and docker compose logs api"
}

on_exit() {
	status=$?
	trap - EXIT
	set +e
	if [ "$status" -ne 0 ] && [ "$stopped" = true ]; then rollback; fi
	if [ "$staged" = true ]; then
		api_sh run 'rm -rf /data/.restoring /media/.restoring' || log "temporary folders were left on the volumes (/data/.restoring, /media/.restoring): they are deleted on the next restore"
	fi
	rm -rf "$work" "$BACKUP_DIR/.pre-restore.partial"
	exit "$status"
}

work=$(mktemp -d)
pre=
saved=false
staged=false
stopped=false
swapped=false
trap on_exit EXIT
trap 'exit 1' HUP INT TERM

log "1/5 preparing volumes"
compose run --rm init-permissions

log "2/5 copying the snapshot to temporary folders on the volumes"
staged=true
stage_data "$snapshot" || exit 1
stage_media || exit 1

log "3/5 saving what is there today"
if api_running; then
	save_current exec || die "could not save the previous copy with the API running: nothing was changed"
fi

log "4/5 stopping api and builder, and swapping database and media"
stopped=true
compose stop api builder
if [ "$saved" = false ]; then
	save_current run || die "could not save the previous copy of the volume: nothing was changed"
fi
swapped=true
api_sh run "$INSTALL"
log "new session keys: the admin has to sign in again"

log "5/5 starting, waiting for the healthchecks and requesting a site build"
compose up -d --wait
compose exec -T builder node src/request-build.ts
stopped=false

log "restored from $snapshot${pre:+ (the previous state is in $pre: delete it when you no longer need it)}"
