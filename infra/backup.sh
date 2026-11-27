#!/bin/sh
# Blog backup: the SQLite database and the uploaded media, rotating 7 daily and 4 weekly snapshots, with an optional
# remote copy through rclone. It can run while the site is serving: the API makes the consistent copy of the database.
# Configuration and folder layout: infra/backup-common.sh. Restore: infra/restore.sh.
#
# The session keys (Data Protection) are not copied on purpose: a backup predates a logout, and with its keys (and the
# session epoch in its database) a cookie revoked later would be valid again. A restore starts with new keys.
#
# On the VPS, once a day with cron (crontab -e of the user that runs Docker):
#
#   15 3 * * * BACKUP_RCLONE_REMOTE=secret:blog sh /path/to/repo/infra/backup.sh >> /var/log/blog-backup.log 2>&1
#
# Local production copy (from infra/):
#
#   COMPOSE_FILE=docker-compose.yml:compose.local.yml ENV_FILE=local.env BACKUP_DIR=/tmp/blog-backups sh backup.sh
#
# Remote copy (BACKUP_RCLONE_REMOTE): it must be an rclone `crypt` remote, because the backup holds the admin password
# hash and the unpublished drafts; an unencrypted one is rejected unless BACKUP_ALLOW_PLAINTEXT=1. It is uploaded with
# `rclone copy`, which never deletes there: a `sync` would also copy the deletions from here, and a run with an empty
# local folder (a new disk, a mistyped BACKUP_DIR) would take the whole remote history with it. Old snapshots are
# rotated there in a separate step, only if the local set is complete, with a cap on deletions and moving what is
# rotated to deleted/<UTC>/.

# shellcheck source=infra/backup-common.sh
. "$(dirname "$0")/backup-common.sh"

KEEP_DAILY=7
KEEP_WEEKLY=4
# How many files the retention may delete there, per folder and per run: a normal day rotates one snapshot (one file,
# blog.db); twice that gives room, and more than that is a sign that something is wrong here.
REMOTE_MAX_DELETE=2
# What the retention takes out of the remote stays in deleted/<UTC>/ and is really deleted only after this time.
REMOTE_KEEP_DELETED=30d

# Names of the snapshots in folder $1, oldest to newest (they are UTC dates: alphabetical order is chronological).
# Hidden ones excluded: a half-made snapshot (.<UTC>.partial) does not count.
snapshots() {
	for path in "$1"/*; do
		if [ -d "$path" ]; then printf '%s\n' "${path##*/}"; fi
	done | LC_ALL=C sort
}

# Deletes the snapshots in $1 except the $2 newest.
prune() {
	snapshots "$1" | LC_ALL=C sort -r | tail -n +"$(($2 + 1))" | while read -r old; do
		rm -rf "${1:?}/$old"
		log "rotated: $1/$old"
	done
}

# Path inside the remote, with or without a base folder (secret: or secret:blog).
remote_path() {
	case $BACKUP_RCLONE_REMOTE in
	*:) printf %s "$BACKUP_RCLONE_REMOTE$1" ;;
	*) printf %s "${BACKUP_RCLONE_REMOTE%/}/$1" ;;
	esac
}

offsite() {
	if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
		log "no BACKUP_RCLONE_REMOTE: the backup stays only in $BACKUP_DIR"
		return
	fi
	if ! command -v rclone >/dev/null 2>&1; then
		log "BACKUP_RCLONE_REMOTE is set but rclone is not installed: the backup stays only in $BACKUP_DIR"
		return
	fi
	remote_type=$(rclone listremotes --long | awk -v name="${BACKUP_RCLONE_REMOTE%%:*}:" '$1 == name { print $2 }')
	if [ "$remote_type" != crypt ] && [ "${BACKUP_ALLOW_PLAINTEXT:-}" != 1 ]; then
		die "$BACKUP_RCLONE_REMOTE is not an rclone crypt remote and the backup holds the admin hash and the drafts: create a crypt one (rclone config) or accept it unencrypted with BACKUP_ALLOW_PLAINTEXT=1. The local backup is in $BACKUP_DIR"
	fi

	# --size-only: what is uploaded never changes (snapshots named by date, media named by hash), so the size is enough
	# to know what is missing or was cut. Comparing dates fails on remotes that store them with less precision:
	# everything would look changed, it would be uploaded again and the retention would move every file to deleted/.
	rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" --size-only
	log "copied to $BACKUP_RCLONE_REMOTE"

	# Retention there: only with the complete local set and with today's snapshot as the newest. Otherwise something is
	# missing here (an empty or changed folder) and rotating there with this as the reference would delete good history.
	daily_count=$(snapshots "$BACKUP_DIR/daily" | wc -l | tr -d ' ')
	newest=$(snapshots "$BACKUP_DIR/daily" | tail -n 1)
	if [ "$daily_count" -lt "$KEEP_DAILY" ]; then
		log "remote retention skipped: there are $daily_count local daily snapshots and $KEEP_DAILY are needed (nothing is deleted there)"
		return
	fi
	if [ "$newest" != "$stamp" ]; then
		log "remote retention skipped: the newest daily snapshot ($newest) is not this run's (nothing is deleted there)"
		return
	fi
	for kind in daily weekly; do
		rclone sync "$BACKUP_DIR/$kind" "$(remote_path "$kind")" --size-only \
			--max-delete "$REMOTE_MAX_DELETE" --backup-dir "$(remote_path "deleted/$stamp/$kind")"
	done
	# Folders left empty are deleted separately and without a filter: with --min-age, --rmdirs sees folders with recent
	# files as empty (those files are filtered out), tries to delete them and fails.
	if rclone lsf --dirs-only "$BACKUP_RCLONE_REMOTE" | grep -qx 'deleted/'; then
		rclone delete "$(remote_path deleted)" --min-age "$REMOTE_KEEP_DELETED"
		rclone rmdirs "$(remote_path deleted)" --leave-root
	fi
	log "remote retention applied: what was rotated there stays in $(remote_path "deleted/$stamp") for $REMOTE_KEEP_DELETED"
}

stamp=$(utc_stamp)
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/media"
[ ! -e "$BACKUP_DIR/daily/$stamp" ] || die "there is already a backup daily/$stamp (two runs in the same second)"
# Built in a hidden folder and renamed at the end: a half-made backup never looks like a snapshot (nor is it rotated).
work="$BACKUP_DIR/daily/.$stamp.partial"
mkdir "$work"
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM
log "backup $stamp in $BACKUP_DIR"

# 1. Database: the API's consistent copy, fetched whole and checked. First the database and then the media: media
#    copied afterwards includes everything the database uses. Before that, the copies a run killed abruptly (kill, a
#    VPS reboot) left on the volume: older than a day, they belong to no run in progress.
api_sh exec '[ ! -d /data/backups ] || find /data/backups -name "blog-*.db" -mtime +0 -exec rm -f {} +'
api_backup "$work/blog.db"
verify_db "$work" || die "the database does not pass PRAGMA integrity_check: the snapshot was not saved"

# 2. Media: what is missing from the backup or has a different size there. It arrives in a temporary folder and moves
#    to its final name only if it arrived whole: a cut file with its final name would look copied and never be retried.
volume_sizes exec >"$work/media-volume.txt"
backup_sizes "$BACKUP_DIR/media" >"$work/media-backup.txt"
LC_ALL=C comm -23 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-new.txt"
if [ -s "$work/media-new.txt" ]; then
	mkdir "$work/media"
	paths <"$work/media-new.txt" | api_sh exec 'cd /media && tar -cf - -T -' | tar -C "$work/media" -xf -
	[ "$(backup_sizes "$work/media")" = "$(cat "$work/media-new.txt")" ] ||
		die "the media arrived incomplete: nothing was moved (it is copied again on the next run)"
	sh -euc "$MOVE_FILES" sh "$work/media" "$BACKUP_DIR/media"
	rm -rf "${work:?}/media"
fi
log "media: $(wc -l <"$work/media-new.txt" | tr -d ' ') new files, $(wc -l <"$work/media-volume.txt" | tr -d ' ') in total"
rm "$work"/media-*.txt

mv "$work" "$BACKUP_DIR/daily/$stamp"
trap - EXIT

# Weekly: if there is none from the last 7 days (so a Sunday without a backup does not leave the week without a copy).
if [ -z "$(find "$BACKUP_DIR/weekly" -mindepth 1 -maxdepth 1 -type d -mtime -7)" ]; then
	cp -R "$BACKUP_DIR/daily/$stamp" "$BACKUP_DIR/weekly/$stamp"
	log "weekly: weekly/$stamp"
fi

prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
log "local backup done: daily/$stamp"

offsite
log "done: daily/$stamp"
