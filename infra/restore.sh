#!/bin/sh
# Restaura un snapshot de infra/backup.sh: base y media, con claves de sesión nuevas (el admin vuelve a entrar: un
# snapshot es de antes de un logout y no puede revivir una sesión revocada). Sin --apply solo revisa el snapshot y
# muestra lo que haría (no toca nada). Configuración: infra/backup-common.sh (las mismas variables que el backup).
#
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z            revisar
#   sh restore.sh /var/backups/blog/daily/20261126T031500Z --apply    restaurar
#
# Desde la copia remota (VPS nuevo): primero `rclone copy "$BACKUP_RCLONE_REMOTE" "$BACKUP_DIR"`, después lo de arriba.
#
# Pasos con --apply. Lo que puede fallar a mitad (traer archivos, que lleguen enteros) se hace antes de parar nada;
# parado el blog, quedan solo renames dentro de cada volumen y levantarlo:
#   1. Prepara los volúmenes (init-permisos: los crea si no existen y les pone el dueño correcto).
#   2. Copia la base y la media que le falte al volumen a carpetas temporales (.restoring) y comprueba que
#      llegaron enteras (CRC y tamaño). Hasta acá no se tocó nada.
#   3. Guarda lo que hay hoy en BACKUP_DIR/pre-restore-<UTC> (con la API en marcha, con su comando backup; parada, el
#      volumen tal cual). Es un snapshot como cualquier otro: se puede restaurar con este mismo script.
#   4. Para la API y el builder (Caddy sigue sirviendo el sitio publicado), cambia base y media por las nuevas y borra
#      las claves de sesión.
#   5. Levanta todo, espera a que los healthchecks den sano y pide un build con la base restaurada.
#   Si algo falla desde el paso 4, vuelve a poner la copia previa, levanta todo y dice dónde quedó.

# shellcheck source=infra/backup-common.sh
. "$(dirname "$0")/backup-common.sh"

snapshot=${1:-}
[ -n "$snapshot" ] || {
	echo "Uso: sh restore.sh <carpeta del snapshot> [--apply]" >&2
	exit 2
}
apply=false
if [ "${2:-}" = --apply ]; then apply=true; fi

snapshot=$(absolute "$snapshot")

# ---------- Revisión (siempre) ----------
is_sqlite "$snapshot/blog.db" || die "$snapshot/blog.db no existe o no es una base SQLite"
[ -d "$BACKUP_DIR/media" ] || die "falta $BACKUP_DIR/media"
verify_db "$snapshot" || die "$snapshot/blog.db no pasa PRAGMA integrity_check"
log "snapshot válido: base $(wc -c <"$snapshot/blog.db" | tr -d ' ') bytes (integrity_check ok), $(backup_sizes "$BACKUP_DIR/media" | wc -l | tr -d ' ') archivos de media en $BACKUP_DIR/media"

if [ "$apply" = false ]; then
	cat >&2 <<EOF
Simulación: no se cambió nada. Con --apply:
  1. init-permisos prepara los volúmenes
  2. se copian la base y la media que falte a temporales en los volúmenes, y se comprueba que llegaron enteras
  3. se guarda lo que hay hoy en $BACKUP_DIR/pre-restore-<UTC>
  4. se paran api y builder (Caddy sigue sirviendo el sitio publicado) y se cambia todo por lo restaurado, con claves de
     sesión nuevas: el admin vuelve a entrar
  5. se levanta todo, se espera a los healthchecks y se pide un build del sitio
  Si algo falla desde el paso 4, se vuelve a poner la copia previa y se levanta todo.
EOF
	exit 0
fi

# ---------- Restauración ----------
# Las funciones de acá devuelven su resultado en vez de cortar (set -e no corta dentro de un `if` o un `&&`, y la vuelta
# atrás las usa así): cada paso que falla termina con `|| return 1`.

# Copia el archivo local $1 al volumen como $2 y comprueba, en el mismo contenedor, que llegó entero.
push() {
	[ "$(api_sh run "cat >$2; cksum <$2" <"$1" | crc)" = "$(cksum <"$1" | crc)" ] || {
		log "${1##*/} llegó incompleta a $2"
		return 1
	}
}

# Base (con su -wal, si el snapshot lo tiene) del snapshot $1 a /data/.restoring, listas para el cambio.
stage_data() {
	api_sh run 'rm -rf /data/.restoring; mkdir /data/.restoring' || return 1
	for file in blog.db blog.db-wal; do
		if [ -f "$1/$file" ]; then push "$1/$file" "/data/.restoring/$file" || return 1; fi
	done
}

# La media del backup que el volumen no tiene (o tiene con otro tamaño) a /media/.restoring, comprobada por tamaño.
stage_media() {
	volume_sizes run >"$work/media-volume.txt" || return 1
	backup_sizes "$BACKUP_DIR/media" >"$work/media-backup.txt" || return 1
	LC_ALL=C comm -13 "$work/media-volume.txt" "$work/media-backup.txt" >"$work/media-missing.txt" || return 1
	if [ -s "$work/media-missing.txt" ]; then
		[ "$(paths <"$work/media-missing.txt" | (cd "$BACKUP_DIR/media" && tar -cf - -T -) |
			api_sh run "rm -rf /media/.restoring; mkdir /media/.restoring; tar -C /media/.restoring -xf -; set -- /media/.restoring; $SIZES")" = "$(cat "$work/media-missing.txt")" ] || {
			log "la media llegó incompleta a /media/.restoring"
			return 1
		}
	fi
	log "media: $(wc -l <"$work/media-missing.txt" | tr -d ' ') archivos para agregar"
}

# Lo que hay hoy en el volumen ($1 = exec: la API en marcha hace la copia consistente; run: con la API parada se
# copia tal cual, con el -wal si lo hay, porque ahí puede haber cambios que todavía no pasaron a la base).
save_current() {
	# shellcheck disable=SC2016 # se expande en el contenedor
	present=$(api_sh run 'cd /data; for f in blog.db blog.db-wal; do [ ! -e "$f" ] || echo "$f"; done') || return 1
	if ! printf '%s\n' "$present" | grep -qx blog.db; then
		log "no hay base en el volumen: no hace falta copia previa"
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
					log "$file llegó incompleta desde el volumen"
					return 1
				}
			fi
		done
	fi
	target="$BACKUP_DIR/pre-restore-$(utc_stamp)"
	mv "$partial" "$target" || return 1
	pre=$target
	saved=true
	log "copia previa: $pre"
}

# El cambio, con la API parada: renames dentro de cada volumen, nada que pueda llegar a medias. Las claves de sesión se
# borran (la API crea otras al arrancar): ninguna cookie emitida antes vale, tampoco una que un logout ya había revocado
# y que la época de sesiones de la base restaurada volvería a aceptar. Vale también al volver a la copia previa. Caddy (otro usuario)
# tiene que poder leer la media: tar la extrae con los permisos del backup (solo el dueño) y acá se le devuelven.
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
		if stage_data "$pre" && api_sh run "$INSTALL"; then
			log "el restore falló: se volvió a poner la copia previa $pre"
		else
			log "ATENCIÓN: el restore falló y no se pudo volver a poner la copia previa sola. A mano: sh restore.sh $pre --apply"
		fi
	elif [ "$swapped" = true ]; then
		log "el restore falló: no había base antes, así que queda la restaurada"
	fi
	compose up -d --wait || log "ATENCIÓN: el blog no levantó sano: revisá con docker compose ps y docker compose logs api"
}

on_exit() {
	status=$?
	trap - EXIT
	set +e
	if [ "$status" -ne 0 ] && [ "$stopped" = true ]; then rollback; fi
	if [ "$staged" = true ]; then
		api_sh run 'rm -rf /data/.restoring /media/.restoring' || log "quedaron temporales en los volúmenes (/data/.restoring, /media/.restoring): se borran en el próximo restore"
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

log "1/5 preparando volúmenes"
compose run --rm init-permisos

log "2/5 copiando el snapshot a temporales en los volúmenes"
staged=true
stage_data "$snapshot" || exit 1
stage_media || exit 1

log "3/5 guardando lo que hay hoy"
if api_running; then
	save_current exec || die "no se pudo guardar la copia previa con la API en marcha: no se cambió nada"
fi

log "4/5 parando api y builder, y cambiando base y media"
stopped=true
compose stop api builder
if [ "$saved" = false ]; then
	save_current run || die "no se pudo guardar la copia previa del volumen: no se cambió nada"
fi
swapped=true
api_sh run "$INSTALL"
log "claves de sesión nuevas: el admin tiene que volver a entrar"

log "5/5 levantando, esperando los healthchecks y pidiendo un build del sitio"
compose up -d --wait
compose exec -T builder node src/request-build.ts
stopped=false

log "restaurado desde $snapshot${pre:+ (lo de antes quedó en $pre: borralo cuando no lo necesites)}"
