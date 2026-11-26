# Lo que comparten backup.sh y restore.sh: se incluye con `.`, no se ejecuta solo.
#
# Configuración (variables de entorno, todas opcionales):
#   BACKUP_DIR              carpeta de los backups                          (por defecto /var/backups/blog)
#   ENV_FILE                --env-file de docker compose, relativo a infra/ (por defecto .env)
#   COMPOSE_FILE            archivos de compose: la variable estándar de Docker (por defecto docker-compose.yml)
#   BACKUP_RCLONE_REMOTE    destino de rclone (ej. secreto:blog); sin él, el backup queda solo en el VPS. Tiene que ser
#                           un remote `crypt` (rclone config → crypt, sobre el S3/B2/Drive que uses): el backup lleva el
#                           hash de la contraseña del admin y los borradores sin publicar, que no deben quedar legibles allá.
#   BACKUP_ALLOW_PLAINTEXT  1 para aceptar igual un remote sin cifrar (bajo tu responsabilidad)
#
# Estructura de BACKUP_DIR (la misma en el remoto):
#   daily/<UTC>/blog.db      la base SQLite: copia consistente hecha por la API mientras atiende
#   weekly/<UTC>/            lo mismo, una por semana
#   media/                   imágenes y videos subidos, acumulados. Los nombres salen del hash del contenido y nunca
#                            cambian: cada día se copian solo los nuevos (una copia entera por snapshot llenaría el
#                            disco), y sirve para cualquier snapshot porque tiene todo lo que usa cualquiera de sus bases.
#   pre-restore-<UTC>/       lo que había en el volumen justo antes de un restore (blog.db y a veces blog.db-wal): para deshacerlo con el mismo restore.sh. No se rota: borralo cuando no lo quieras.

set -eu
# Los backups tienen la base (hash del admin, borradores): solo los lee el dueño.
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

die() {
	log "$*"
	exit 1
}

utc_stamp() {
	date -u +%Y%m%dT%H%M%SZ
}

# Corre un script de sh con los volúmenes de la API (/data, /media), como el usuario de la API. $1 = exec: en el
# contenedor en marcha; run: en uno aparte (con la API parada, o para no depender de ella). La entrada y la salida
# pasan tal cual (por ahí viajan la base y la media).
api_sh() {
	mode=$1
	shift
	if [ "$mode" = exec ]; then
		compose exec -T api sh -euc "$1"
	else
		compose run --rm --no-deps -T --entrypoint sh api -euc "$1"
	fi
}

api_running() {
	[ -n "$(compose ps --status running -q api)" ]
}

# "CRC bytes" de una salida de `cksum`, sin el nombre ni espacios de más: así se comparan el de acá y el del contenedor.
# `cksum` es POSIX (está en el VPS, en la imagen de la API y en busybox) y alcanza para lo que se busca: notar que un
# stream llegó cortado o distinto, no defenderse de alguien que lo altere.
crc() {
	awk '{ print $1, $2 }'
}

# Trae el archivo $2 del volumen a $3 y comprueba que llegó entero ($1 = exec|run, como api_sh). Si docker pierde la
# conexión a mitad, `cat` ve fin de archivo y sale con 0: solo comparar el CRC y el tamaño de los dos lados lo nota.
# Devuelve el resultado de esa comparación (sirve en un `if`, donde set -e no corta).
pull() {
	api_sh "$1" "cat $2" >"$3"
	[ "$(api_sh "$1" "cksum <$2" | crc)" = "$(cksum <"$3" | crc)" ]
}

# Copia de la base hecha por la API en marcha (comando `backup`: copia consistente aunque esté escribiendo, en un solo
# archivo sin -wal) y traída a $1. La copia del volumen se borra pase lo que pase: si quedara, se acumularía en el
# volumen vivo.
api_backup() {
	copy=$(api_sh exec 'dotnet Blog.Api.dll backup /data/backups')
	case $copy in
	/data/backups/blog-*.db) ;;
	*) die "el comando backup de la API no devolvió la ruta de la copia (devolvió: $copy)" ;;
	esac
	if pull exec "$copy" "$1"; then complete=true; else complete=false; fi
	api_sh exec "rm -f $copy"
	[ "$complete" = true ] || die "la base llegó incompleta desde $copy"
}

# Revisa la base de la carpeta $1 (con su blog.db-wal, si lo tiene) con PRAGMA integrity_check, en un contenedor
# descartable de la imagen del builder: Node trae SQLite (node:sqlite) y la imagen ya está en el VPS, así que no hace
# falta instalar sqlite3 ni bajar otra imagen. Corre sobre una copia: la base de $1 no se toca. Devuelve el resultado.
verify_db() {
	db_files=blog.db
	if [ -f "$1/blog.db-wal" ]; then db_files="blog.db blog.db-wal"; fi
	# shellcheck disable=SC2086,SC2016 # dos nombres fijos sin espacios; el script se expande en el contenedor
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

# Nombres de los snapshots de la carpeta $1, del más viejo al más nuevo (son fechas UTC: el orden alfabético es el
# cronológico). Sin los ocultos: un snapshot a medias (.<UTC>.partial) no cuenta.
snapshots() {
	for path in "$1"/*; do
		if [ -d "$path" ]; then printf '%s\n' "${path##*/}"; fi
	done | LC_ALL=C sort
}

is_sqlite() {
	[ "$(dd if="$1" bs=15 count=1 2>/dev/null)" = "SQLite format 3" ]
}

# Lista "<ruta> <bytes>" de los archivos de la carpeta $1, ordenada para `comm`: comparar nombre y tamaño encuentra lo
# que falta y lo que quedó truncado (mismo nombre, menos bytes). Sin los .tmp de una subida en curso (la API escribe a
# un temporal y lo renombra al terminar) ni la carpeta .restoring de un restore en curso. Es texto para `sh -euc`
# porque corre acá (el backup) y dentro del contenedor de la API (el volumen); `wc -c` no lee el contenido.
# shellcheck disable=SC2016 # se expande en el sh que lo corre, no acá
SIZES='cd "$1" && find . -type f ! -name "*.tmp" ! -path "./.restoring/*" -exec wc -c {} + |
	sed -n "s|^ *\([0-9][0-9]*\) \./\(.*\)|\2 \1|p" | LC_ALL=C sort'

backup_sizes() {
	sh -euc "$SIZES" sh "$1"
}

volume_sizes() {
	api_sh "$1" "set -- /media; $SIZES"
}

# De una lista de SIZES, solo las rutas (lo que lee `tar -T`).
paths() {
	sed 's/ [0-9][0-9]*$//'
}

# Mueve cada archivo de la carpeta $1 a la misma ruta dentro de $2 (absoluta), creando las carpetas: así un archivo
# aparece con su nombre final solo cuando llegó entero. `mv` dentro del mismo disco es un rename atómico. Texto para
# `sh -euc` por lo mismo que SIZES; lo usan backup.sh y restore.sh.
# shellcheck disable=SC2016,SC2034 # se expande en el sh que lo corre, no acá
MOVE_FILES='cd "$1" && find . -type f | while IFS= read -r f; do
	mkdir -p "$2/${f%/*}"
	mv -f "$f" "$2/$f"
done'
