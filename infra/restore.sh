#!/bin/sh
# Restaura un snapshot de infra/backup.sh: base, claves de sesión y media. Sin --apply solo revisa el snapshot y
# muestra lo que haría (no toca nada). Configuración: infra/backup-common.sh (las mismas variables que el backup).
#
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z            revisar
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z --apply    restaurar
#
# Desde la copia remota (VPS nuevo): primero `rclone copy "$BACKUP_RCLONE_REMOTE" "$BACKUP_DIR"`, después lo de arriba.
#
# Pasos con --apply:
#   1. Prepara los volúmenes (init-permisos: los crea si no existen y les pone el dueño correcto).
#   2. Para la API y el builder. Caddy sigue sirviendo el sitio publicado mientras tanto.
#   3. Reemplaza la base (y descarta su -wal/-shm) y las claves; agrega la media que le falte al volumen.
#   4. Levanta todo y espera a que los healthchecks den sano (la API responde con la base restaurada).
#   5. Pide un build: el sitio publicado vuelve a salir de la base restaurada.

. "$(dirname "$0")/backup-common.sh"

snapshot=${1:-}
[ -n "$snapshot" ] || {
	echo "Uso: sh restore.sh <carpeta del snapshot> [--apply]" >&2
	exit 2
}
apply=false
[ "${2:-}" = --apply ] && apply=true

snapshot=$(absolute "$snapshot")

# ---------- Revisión (siempre) ----------
is_sqlite "$snapshot/blog.db" || {
	log "$snapshot/blog.db no existe o no es una base SQLite"
	exit 1
}
tar -tf "$snapshot/keys.tar" >/dev/null || {
	log "$snapshot/keys.tar no existe o está dañado"
	exit 1
}
[ -d "$BACKUP_DIR/media" ] || {
	log "falta $BACKUP_DIR/media"
	exit 1
}
media_count=$(backup_media | wc -l | tr -d ' ')
log "snapshot válido: base $(wc -c <"$snapshot/blog.db" | tr -d ' ') bytes, $(tar -tf "$snapshot/keys.tar" | grep -c '\.xml$') claves, $media_count archivos de media en $BACKUP_DIR/media"

if [ "$apply" = false ]; then
	cat >&2 <<EOF
Simulación: no se cambió nada. Con --apply:
  1. init-permisos prepara los volúmenes
  2. se paran api y builder (Caddy sigue sirviendo el sitio publicado)
  3. se reemplazan la base y las claves, y se agrega al volumen la media que le falte
  4. se levanta todo y se espera a los healthchecks
  5. se pide un build del sitio con la base restaurada
EOF
	exit 0
fi

# ---------- Restauración ----------
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

log "1/5 preparando volúmenes"
compose run --rm init-permisos

log "2/5 parando api y builder"
compose stop api builder

log "3/5 restaurando base, claves y media"
api_sh run 'cat >/data/blog.db.restoring; rm -f /data/blog.db-wal /data/blog.db-shm; mv /data/blog.db.restoring /data/blog.db' <"$snapshot/blog.db"
api_sh run 'rm -rf /data/keys; tar -C /data -xf -' <"$snapshot/keys.tar"
volume_media run >"$work/media-volume.txt"
backup_media >"$work/media-backup.txt"
LC_ALL=C comm -13 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-missing.txt"
if [ -s "$work/media-missing.txt" ]; then
	# Caddy (otro usuario) tiene que poder leer la media: si el backup la guardó sin permiso de lectura para otros (tar
	# extrae con el umask 077 del backup cuando no corre como root), se le devuelve.
	(cd "$BACKUP_DIR/media" && tar -cf - -T "$work/media-missing.txt") |
		api_sh run 'tar -C /media -xf -; find /media ! -perm -a+r -exec chmod a+rX {} +'
fi
log "media: $(wc -l <"$work/media-missing.txt" | tr -d ' ') archivos agregados"

log "4/5 levantando y esperando los healthchecks"
compose up -d --wait

log "5/5 pidiendo un build del sitio"
compose exec -T builder node src/request-build.ts

log "restaurado desde $snapshot"
