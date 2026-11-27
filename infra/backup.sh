#!/bin/sh
# Backup del blog: base SQLite y media subida, con rotación de 7 diarios y 4 semanales, y copia
# remota opcional con rclone. Se puede correr con el sitio atendiendo: la API hace la copia consistente de la base.
# Configuración y estructura de la carpeta: infra/backup-common.sh. Restaurar: infra/restore.sh.
#
# Las claves de sesión (Data Protection) no se copian a propósito: un backup es de antes de un logout, y con sus claves
# (y la época de sesiones de su base) una cookie revocada después volvería a valer. Restaurar empieza con claves nuevas.
#
# En el VPS, una vez por día con cron (crontab -e del usuario que maneja Docker):
#
#   15 3 * * * BACKUP_RCLONE_REMOTE=secreto:blog sh /ruta/al/repo/infra/backup.sh >> /var/log/blog-backup.log 2>&1
#
# Copia local de producción (desde infra/):
#
#   COMPOSE_FILE=docker-compose.yml:compose.local.yml ENV_FILE=local.env BACKUP_DIR=/tmp/blog-backups sh backup.sh
#
# Copia remota (BACKUP_RCLONE_REMOTE): tiene que ser un remote `crypt` de rclone, porque el backup lleva el hash de la
# contraseña del admin y los borradores sin publicar; uno sin cifrar se rechaza salvo con BACKUP_ALLOW_PLAINTEXT=1. Se sube con
# `rclone copy`, que nunca borra allá: un `sync` copiaría también los borrados de acá, y una corrida con la carpeta local
# vacía (disco nuevo, BACKUP_DIR mal escrito) se llevaría todo el historial remoto. Los snapshots viejos se rotan allá en
# un paso aparte, solo si el set local está completo, con tope de borrados y moviendo lo rotado a deleted/<UTC>/.

# shellcheck source=infra/backup-common.sh
. "$(dirname "$0")/backup-common.sh"

KEEP_DAILY=7
KEEP_WEEKLY=4
# Cuántos archivos puede borrar allá la retención, por carpeta y por corrida: un día normal rota un snapshot (un archivo,
# blog.db); el doble da margen, y más que eso es señal de que algo anda mal acá.
REMOTE_MAX_DELETE=2
# Lo que la retención saca del remoto queda en deleted/<UTC>/ y se borra de verdad recién pasado este tiempo.
REMOTE_KEEP_DELETED=30d

# Borra los snapshots de $1 salvo los $2 más nuevos.
prune() {
	snapshots "$1" | LC_ALL=C sort -r | tail -n +"$(($2 + 1))" | while read -r old; do
		rm -rf "${1:?}/$old"
		log "rotado: $1/$old"
	done
}

# Ruta dentro del remoto, con o sin carpeta base (secreto: o secreto:blog).
remote_path() {
	case $BACKUP_RCLONE_REMOTE in
	*:) printf %s "$BACKUP_RCLONE_REMOTE$1" ;;
	*) printf %s "${BACKUP_RCLONE_REMOTE%/}/$1" ;;
	esac
}

offsite() {
	if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
		log "sin BACKUP_RCLONE_REMOTE: el backup queda solo en $BACKUP_DIR"
		return
	fi
	if ! command -v rclone >/dev/null 2>&1; then
		log "BACKUP_RCLONE_REMOTE está definido pero rclone no está instalado: el backup queda solo en $BACKUP_DIR"
		return
	fi
	remote_type=$(rclone listremotes --long | awk -v name="${BACKUP_RCLONE_REMOTE%%:*}:" '$1 == name { print $2 }')
	if [ "$remote_type" != crypt ] && [ "${BACKUP_ALLOW_PLAINTEXT:-}" != 1 ]; then
		die "$BACKUP_RCLONE_REMOTE no es un remote crypt de rclone y el backup lleva el hash del admin y los borradores: creá uno crypt (rclone config) o aceptalo sin cifrar con BACKUP_ALLOW_PLAINTEXT=1. El backup local quedó en $BACKUP_DIR"
	fi

	# --size-only: lo que se sube nunca cambia (snapshots con nombre de fecha, media con nombre de hash), así que el
	# tamaño alcanza para saber qué falta o quedó cortado. Comparar fechas falla en remotos que las guardan con menos
	# precisión: todo parecería cambiado, se volvería a subir y la retención movería cada archivo a deleted/.
	rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" --size-only
	log "copiado a $BACKUP_RCLONE_REMOTE"

	# Retención allá: solo con el set local completo y con el snapshot de hoy como el más nuevo. Si no, acá falta algo
	# (carpeta vacía o cambiada) y rotar allá con esto de referencia borraría historial bueno.
	daily_count=$(snapshots "$BACKUP_DIR/daily" | wc -l | tr -d ' ')
	newest=$(snapshots "$BACKUP_DIR/daily" | tail -n 1)
	if [ "$daily_count" -lt "$KEEP_DAILY" ]; then
		log "retención remota salteada: hay $daily_count diarios locales y hacen falta $KEEP_DAILY (no se borra nada allá)"
		return
	fi
	if [ "$newest" != "$stamp" ]; then
		log "retención remota salteada: el diario más nuevo ($newest) no es el de esta corrida (no se borra nada allá)"
		return
	fi
	for kind in daily weekly; do
		rclone sync "$BACKUP_DIR/$kind" "$(remote_path "$kind")" --size-only \
			--max-delete "$REMOTE_MAX_DELETE" --backup-dir "$(remote_path "deleted/$stamp/$kind")"
	done
	# Las carpetas que quedan vacías se borran aparte y sin filtro: con --min-age, --rmdirs ve vacías las carpetas con
	# archivos recientes (quedan fuera del filtro), intenta borrarlas y falla.
	if rclone lsf --dirs-only "$BACKUP_RCLONE_REMOTE" | grep -qx 'deleted/'; then
		rclone delete "$(remote_path deleted)" --min-age "$REMOTE_KEEP_DELETED"
		rclone rmdirs "$(remote_path deleted)" --leave-root
	fi
	log "retención remota aplicada: lo que se rotó allá queda en $(remote_path "deleted/$stamp") por $REMOTE_KEEP_DELETED"
}

stamp=$(utc_stamp)
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/media"
[ ! -e "$BACKUP_DIR/daily/$stamp" ] || die "ya hay un backup daily/$stamp (dos corridas en el mismo segundo)"
# Se arma en una carpeta oculta y se renombra al final: un backup a medias nunca parece un snapshot (ni se rota).
work="$BACKUP_DIR/daily/.$stamp.partial"
mkdir "$work"
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM
log "backup $stamp en $BACKUP_DIR"

# 1. Base: copia consistente de la API, traída entera y revisada. Primero la base y después la media: la media copiada
#    después incluye todo lo que la base usa. Antes, las copias que una corrida cortada de golpe (kill, reinicio del
#    VPS) dejó en el volumen: con más de un día no son de ninguna corrida en curso.
api_sh exec '[ ! -d /data/backups ] || find /data/backups -name "blog-*.db" -mtime +0 -exec rm -f {} +'
api_backup "$work/blog.db"
verify_db "$work" || die "la base no pasa PRAGMA integrity_check: no se guardó el snapshot"

# 2. Media: lo que falta en el backup o quedó con otro tamaño. Llega a una carpeta temporal y se mueve a su nombre
#    final solo si llegó entera: un archivo cortado con su nombre final parecería copiado y nunca se repetiría.
volume_sizes exec >"$work/media-volume.txt"
backup_sizes "$BACKUP_DIR/media" >"$work/media-backup.txt"
LC_ALL=C comm -23 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-new.txt"
if [ -s "$work/media-new.txt" ]; then
	mkdir "$work/media"
	paths <"$work/media-new.txt" | api_sh exec 'cd /media && tar -cf - -T -' | tar -C "$work/media" -xf -
	[ "$(backup_sizes "$work/media")" = "$(cat "$work/media-new.txt")" ] ||
		die "la media llegó incompleta: no se movió nada (se vuelve a copiar en la próxima corrida)"
	sh -euc "$MOVE_FILES" sh "$work/media" "$BACKUP_DIR/media"
	rm -rf "${work:?}/media"
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
log "backup local listo: daily/$stamp"

offsite
log "listo: daily/$stamp"
