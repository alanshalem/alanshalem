# Lo que comparten backup.sh y restore.sh: se incluye con `.`, no se ejecuta solo.
#
# Configuración (variables de entorno, todas opcionales):
#   BACKUP_DIR            carpeta de los backups                          (por defecto /var/backups/blog)
#   ENV_FILE              --env-file de docker compose, relativo a infra/ (por defecto .env)
#   COMPOSE_FILE          archivos de compose: la variable estándar de Docker (por defecto docker-compose.yml)
#   BACKUP_RCLONE_REMOTE  destino de rclone (ej. b2:mi-bucket/blog); sin él, el backup queda solo en el VPS
#
# Estructura de BACKUP_DIR (la misma en el remoto):
#   daily/<UTC>/blog.db    la base SQLite: copia consistente hecha por la API mientras atiende
#   daily/<UTC>/keys.tar   claves de Data Protection: sin ellas, las sesiones abiertas del admin dejan de valer
#   weekly/<UTC>/          lo mismo, una por semana
#   media/                 imágenes y videos subidos, acumulados. Los nombres salen del hash del contenido y nunca
#                          cambian: cada día se copian solo los nuevos (una copia entera por snapshot llenaría el disco),
#                          y sirve para cualquier snapshot porque tiene todo lo que usa cualquiera de sus bases.

set -eu
# Los backups tienen la base (hash del admin) y las claves de sesión: solo los lee el dueño.
umask 077

# Las rutas relativas que recibe el script son las de donde se lo llamó; compose, en cambio, corre desde infra/ (donde
# están docker-compose.yml y .env).
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

# Corre un script de sh con los volúmenes de la API (/data, /media), como el usuario de la API. $1 = exec: en el
# contenedor en marcha (backup); run: en uno aparte, con la API parada (restore). La entrada y la salida pasan tal cual
# (por ahí viajan la base, las claves y la media).
api_sh() {
	mode=$1
	shift
	if [ "$mode" = exec ]; then
		compose exec -T api sh -euc "$1"
	else
		compose run --rm --no-deps -T --entrypoint sh api -euc "$1"
	fi
}

# Archivos de /media, relativos y ordenados para `comm`. Sin los .tmp de una subida en curso (la API escribe a un
# temporal y lo renombra al terminar).
volume_media() {
	api_sh "$1" "cd /media && find . -type f ! -name '*.tmp'" | sed 's|^\./||' | LC_ALL=C sort
}

backup_media() {
	(cd "$BACKUP_DIR/media" && find . -type f) | sed 's|^\./||' | LC_ALL=C sort
}

is_sqlite() {
	[ "$(dd if="$1" bs=15 count=1 2>/dev/null)" = "SQLite format 3" ]
}
