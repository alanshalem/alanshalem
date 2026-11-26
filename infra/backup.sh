#!/bin/sh
# Backup del blog: base SQLite, claves de sesión y media subida, con rotación de 7 diarios y 4 semanales, y copia
# remota opcional con rclone. Se puede correr con el sitio atendiendo: la API hace la copia consistente de la base.
# Configuración y estructura de la carpeta: infra/backup-common.sh. Restaurar: infra/restore.sh.
#
# En el VPS, una vez por día con cron (crontab -e del usuario que maneja Docker):
#
#   15 3 * * * BACKUP_RCLONE_REMOTE=b2:mi-bucket/blog sh /ruta/al/repo/infra/backup.sh >> /var/log/blog-backup.log 2>&1
#
# Copia local de producción (desde infra/):
#
#   COMPOSE_FILE=docker-compose.yml:compose.local.yml ENV_FILE=local.env BACKUP_DIR=/tmp/blog-backups sh backup.sh

. "$(dirname "$0")/backup-common.sh"

KEEP_DAILY=7
KEEP_WEEKLY=4

# Borra los snapshots de $1 salvo los $2 más nuevos (los nombres son fechas UTC: el orden alfabético es el cronológico).
prune() {
	ls -1 "$1" | LC_ALL=C sort -r | tail -n +"$(($2 + 1))" | while read -r old; do
		rm -rf "${1:?}/$old"
		log "rotado: $1/$old"
	done
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/media"
if [ -e "$BACKUP_DIR/daily/$stamp" ]; then
	log "ya hay un backup daily/$stamp (dos corridas en el mismo segundo)"
	exit 1
fi
# Se arma en una carpeta oculta y se renombra al final: un backup a medias nunca parece un snapshot (ni se rota).
work="$BACKUP_DIR/daily/.$stamp.partial"
mkdir "$work"
trap 'rm -rf "$work"' EXIT
log "backup $stamp en $BACKUP_DIR"

# 1. Base: la API la copia en el volumen (contrato del comando `backup`: imprime la ruta), sale por la salida estándar y
#    se borra de ahí. Primero la base y después la media: la media copiada después incluye todo lo que la base usa.
api_sh exec 'db=$(dotnet Blog.Api.dll backup /data/backups); cat "$db"; rm -f "$db"' >"$work/blog.db"
is_sqlite "$work/blog.db" || {
	log "la copia de la base no es SQLite"
	exit 1
}

# 2. Claves de Data Protection.
api_sh exec 'tar -C /data -cf - keys' >"$work/keys.tar"

# 3. Media: solo lo que falta en el backup.
volume_media exec >"$work/media-volume.txt"
backup_media >"$work/media-backup.txt"
LC_ALL=C comm -23 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-new.txt"
if [ -s "$work/media-new.txt" ]; then
	api_sh exec 'cd /media && tar -cf - -T -' <"$work/media-new.txt" | tar -C "$BACKUP_DIR/media" -xf -
fi
# Un tubo solo informa el error del último comando: se comprueba que no falte nada.
backup_media >"$work/media-backup.txt"
if [ -n "$(LC_ALL=C comm -23 "$work/media-volume.txt" "$work/media-backup.txt")" ]; then
	log "faltan archivos de media en el backup"
	exit 1
fi
log "media: $(wc -l <"$work/media-new.txt" | tr -d ' ') archivos nuevos, $(wc -l <"$work/media-volume.txt" | tr -d ' ') en total"
rm "$work"/media-*.txt

mv "$work" "$BACKUP_DIR/daily/$stamp"
trap - EXIT

# Semanal: si no hay uno de los últimos 7 días (así un domingo sin backup no deja la semana sin copia).
if [ -z "$(find "$BACKUP_DIR/weekly" -mindepth 1 -maxdepth 1 -type d -mtime -7)" ]; then
	cp -R "$BACKUP_DIR/daily/$stamp" "$BACKUP_DIR/weekly/$stamp"
	log "semanal: weekly/$stamp"
fi

prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

# Copia remota: el mismo árbol. `sync` borra allá los snapshots rotados acá; la media local nunca se borra, así que
# allá tampoco.
if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
	log "sin BACKUP_RCLONE_REMOTE: el backup queda solo en $BACKUP_DIR"
elif ! command -v rclone >/dev/null 2>&1; then
	log "BACKUP_RCLONE_REMOTE está definido pero rclone no está instalado: el backup queda solo en $BACKUP_DIR"
else
	rclone sync "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE"
	log "copiado a $BACKUP_RCLONE_REMOTE"
fi

log "listo: daily/$stamp"
