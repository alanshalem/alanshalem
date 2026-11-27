# What backup.sh and restore.sh share: it is included with `.`, not run on its own.
#
# Configuration (environment variables, all optional):
#   BACKUP_DIR              backup folder                                     (default /var/backups/blog)
#   ENV_FILE                docker compose --env-file, relative to infra/     (default .env)
#   COMPOSE_FILE            compose files: Docker's standard variable         (default docker-compose.yml)
#   BACKUP_RCLONE_REMOTE    rclone destination (e.g. secret:blog); without it the backup stays only on the VPS. It must
#                           be a `crypt` remote (rclone config → crypt, over the S3/B2/Drive you use): the backup holds
#                           the admin password hash and the unpublished drafts, which must not be readable there.
#   BACKUP_ALLOW_PLAINTEXT  1 to accept an unencrypted remote anyway (at your own risk)
#
# BACKUP_DIR layout (the same on the remote):
#   daily/<UTC>/blog.db      the SQLite database: a consistent copy made by the API while it serves
#   weekly/<UTC>/            the same, one per week
#   media/                   uploaded images and videos, accumulated. Names come from the content hash and never
#                            change: each day only the new ones are copied (a full copy per snapshot would fill the
#                            disk), and it serves any snapshot because it has everything any of its databases uses.
#   pre-restore-<UTC>/       what the volume had right before a restore (blog.db and sometimes blog.db-wal), to undo
#                            it with the same restore.sh. It is not rotated: delete it when you no longer want it.

set -eu
# Backups hold the database (admin hash, drafts): only the owner reads them.
umask 077

# Relative paths given to the script are relative to where it was called from; compose, instead, runs from infra/
# (where docker-compose.yml and .env are).
caller_dir=$PWD
absolute() {
	case $1 in /*) printf %s "$1" ;; *) printf %s "$caller_dir/$1" ;; esac
}
BACKUP_DIR=$(absolute "${BACKUP_DIR:-/var/backups/blog}")
ENV_FILE=${ENV_FILE:-.env}
cd "$(dirname "$0")"

compose() {
	docker compose --env-file "$ENV_FILE" "$@"
}

log() {
	printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
	log "$*"
	exit 1
}

utc_stamp() {
	date -u +%Y%m%dT%H%M%SZ
}

# Runs a sh script with the API's volumes (/data, /media), as the API user. $1 = exec: in the running container; run:
# in a separate one (with the API stopped, or so as not to depend on it). Input and output pass through untouched (the
# database and the media travel through them).
api_sh() {
	mode=$1
	shift
	if [ "$mode" = exec ]; then
		compose exec -T api sh -euc "$1"
	else
		compose run --rm --no-deps -T --entrypoint sh api -euc "$1"
	fi
}

# "CRC bytes" of a `cksum` output, without the name or extra spaces, so the one from here and the one from the
# container compare. `cksum` is POSIX (it is on the VPS, in the API image and in busybox) and is enough for the goal:
# noticing that a stream arrived cut or different, not defending against someone who tampers with it.
crc() {
	awk '{ print $1, $2 }'
}

# Fetches the file $2 from the volume into $3 and checks that it arrived whole ($1 = exec|run, as in api_sh). If docker
# loses the connection halfway, `cat` sees end of file and exits with 0: only comparing the CRC and the size of both
# sides notices it. Returns the result of that comparison (usable in an `if`, where set -e does not stop).
pull() {
	api_sh "$1" "cat $2" >"$3"
	[ "$(api_sh "$1" "cksum <$2" | crc)" = "$(cksum <"$3" | crc)" ]
}

# Copy of the database made by the running API (the `backup` command: a consistent copy even while it writes, in a
# single file with no -wal) and fetched into $1. The copy on the volume is deleted no matter what: if it stayed, it
# would pile up on the live volume.
api_backup() {
	copy=$(api_sh exec 'dotnet Blog.Api.dll backup /data/backups')
	case $copy in
	/data/backups/blog-*.db) ;;
	*) die "the API backup command did not return the path of the copy (it returned: $copy)" ;;
	esac
	if pull exec "$copy" "$1"; then complete=true; else complete=false; fi
	api_sh exec "rm -f $copy"
	[ "$complete" = true ] || die "the database arrived incomplete from $copy"
}

# Checks the database in folder $1 (with its blog.db-wal, if it has one) with PRAGMA integrity_check, in a throwaway
# container of the builder image: Node ships SQLite (node:sqlite) and the image is already on the VPS, so there is no
# need to install sqlite3 or pull another image. It runs on a copy: the database in $1 is not touched. Returns the
# result.
verify_db() {
	db_files=blog.db
	if [ -f "$1/blog.db-wal" ]; then db_files="blog.db blog.db-wal"; fi
	# shellcheck disable=SC2086,SC2016 # two fixed names without spaces; the script expands inside the container
	tar -C "$1" -cf - $db_files | compose run --rm --no-deps -T builder sh -euc '
		d=$(mktemp -d)
		trap "rm -rf \"$d\"" EXIT
		tar -C "$d" -xf -
		node --no-warnings -e "
			const { DatabaseSync } = require(\"node:sqlite\");
			try {
				const db = new DatabaseSync(process.argv[1]);
				const result = db.prepare(\"PRAGMA integrity_check\").all().map((row) => Object.values(row)[0]).join(\"; \");
				db.close();
				if (result !== \"ok\") throw new Error(result);
			} catch (error) {
				console.error(error.message);
				process.exit(1);
			}
		" "$d/blog.db"'
}

# Lists "<path> <bytes>" for the files in folder $1, sorted for `comm`: comparing name and size finds what is missing
# and what was truncated (same name, fewer bytes). Without the .tmp files of an upload in progress (the API writes to a
# temporary file and renames it when done) or the .restoring folder of a restore in progress. It is text for `sh -euc`
# because it runs here (the backup) and inside the API container (the volume); `wc -c` does not read the content.
# shellcheck disable=SC2016 # expanded in the sh that runs it, not here
SIZES='cd "$1" && find . -type f ! -name "*.tmp" ! -path "./.restoring/*" -exec wc -c {} + |
	sed -n "s|^ *\([0-9][0-9]*\) \./\(.*\)|\2 \1|p" | LC_ALL=C sort'

backup_sizes() {
	sh -euc "$SIZES" sh "$1"
}

volume_sizes() {
	api_sh "$1" "set -- /media; $SIZES"
}

# From a SIZES list, only the paths (what `tar -T` reads).
paths() {
	sed 's/ [0-9][0-9]*$//'
}

# Moves every file in folder $1 to the same path inside $2 (absolute), creating the folders, so a file shows up with
# its final name only once it arrived whole. `mv` within the same disk is an atomic rename. Text for `sh -euc` for the
# same reason as SIZES; backup.sh and restore.sh use it.
# shellcheck disable=SC2016,SC2034 # expanded in the sh that runs it, not here
MOVE_FILES='cd "$1" && find . -type f | while IFS= read -r f; do
	mkdir -p "$2/${f%/*}"
	mv -f "$f" "$2/$f"
done'
