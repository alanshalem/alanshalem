# Blog

> Este repo también es el perfil de GitHub de [@alanshalem](https://github.com/alanshalem): el [`README.md` de la raíz](../README.md)
> es el del perfil (sus imágenes las genera `tooling/profile/`) y este, en `.github/`, es el del proyecto.

Blog propio con editor Markdown, pensado para un VPS chico compartido con otras apps.

## Cómo está armado

```
Visitante ──► Caddy ──► archivos estáticos (HTML precomprimido en br/gzip)
                 │
                 ├─ /media/*   imágenes y videos subidos (cache inmutable, Range)
                 ├─ /admin/*   SPA de administración (React, precomprimida; assets con hash inmutables)
                 └─ /api/*     API .NET  (/api/internal está bloqueado desde afuera; /api/admin/* sin caché)

Admin ──► API ──► SQLite
              └─ al publicar ──► Builder ──► astro build ──► releases/<timestamp>/ ──► symlink `current` (swap atómico)
```

El hero de la home rota en cada visita entre fotos y videos cortos (≤ 15 s) que se suben desde Ajustes. Toda imagen se
guarda optimizada (AVIF + WebP en varios anchos, sin metadatos, con libvips) y cada video se recorta, se le saca el
audio y se codifica con ffmpeg en AV1 + H.264, 720p y 1080p.

La idea: **los visitantes nunca tocan la API ni la base de datos**. Todo lo público es HTML ya generado, así que el
servidor casi no trabaja en reposo y el sitio sigue vivo aunque la API se caiga.

| Carpeta | Qué es |
|---|---|
| `packages/markdown` | Renderer Markdown propio, sin dependencias. Lo usan el admin (preview) y Astro, así que **el preview es idéntico a lo publicado**. |
| `packages/tokens` | Design tokens (`tokens.css`, `tokens.json`) y estilos de `.prose`. |
| `apps/admin` | React 19 + Vite. Editor Markdown nativo (`<textarea>` + funciones puras de comandos). |
| `apps/web` | Astro 7, salida estática. Lee los posts de la API en build time. |
| `apps/api` | .NET 10, Clean Architecture (Domain / Application / Infrastructure / Api), EF Core + SQLite. |
| `apps/builder` | Servicio Node sin dependencias: recibe el pedido de build, genera el sitio y cambia `current` de forma atómica. |
| `infra` | `docker-compose.yml` (VPS), `compose.local.yml` + `local.env` (copia local), `compose.dev.yml` (desarrollo), `caddy/` (Caddyfile y Dockerfile de Caddy, que también compila el admin), `backup.sh` / `restore.sh`. |
| `infra/test` | Guardas de los compose, los Dockerfiles y el Caddyfile, y los scripts de backup con un `docker` falso (`pnpm test:infra`). |
| `tooling/profile` | Generador de las imágenes del README del perfil (`assets/profile/`); lo corre la Action `profile.yml`. |
| `tooling/agents` | Copia las skills a cada agente y lo verifica (`pnpm agents:sync`, `pnpm agents:check`). |
| `.agents/skills` | Skills para agentes (fuente única; `.claude/skills` y `.github/skills` son copias generadas). Contexto general: `AGENTS.md`. |
| `.github/workflows` | `ci.yml` (todo lo de "Cómo verificar" en cada push y PR) y `profile.yml` (imágenes del perfil, diaria). |

## Desarrollo local

Requisitos: Node ≥ 22.18, pnpm 10, .NET SDK 10 y, para los videos del hero, `ffmpeg` y `ffprobe` con `libsvtav1`
(SVT-AV1 4.x, con el que se calibró la codificación) y `libx264`. La API los busca en el PATH; si no, configurá
`Video:FfmpegPath` y `Video:FfprobePath`. Los videos en proceso quedan en `Video:WorkDirectory` (por defecto
`data/video-work`, nunca dentro de `Media:Directory`). libvips no hace falta: viene en el paquete NuGet.

```bash
pnpm install            # y commiteá el pnpm-lock.yaml: las imágenes instalan con --frozen-lockfile
pnpm test               # todos los tests de Node (ver "Cómo verificar")
pnpm typecheck

# API (puerto 5090)
cd apps/api && dotnet test && dotnet run --project src/Blog.Api

# Admin (proxy de /api y /media hacia :5090)
pnpm dev:admin          # http://localhost:5173/admin/

# Sitio público
pnpm build:web
```

## Desarrollo con Docker

Sin instalar .NET, Node ni ffmpeg: solo Docker. Desde la raíz del repo:

```bash
docker compose -f infra/compose.dev.yml --env-file infra/local.env up --build   # Ctrl+C para cortar; `down` borra los contenedores
```

`--env-file infra/local.env` trae la contraseña del admin y el token de prueba: el mismo archivo que usa la copia local
de producción, así se cambian en un solo lugar. Va en todos los comandos de este compose (`up`, `logs`, `down`), como
en la copia local; sin él, compose dice qué variable falta y no hace nada.

| Qué | URL | Recarga en vivo |
|---|---|---|
| Admin (Vite) | http://localhost:5173/admin/ — contraseña `admin` | HMR al guardar |
| Sitio (`astro dev`) | http://localhost:4321/ | recarga la página |
| API (`dotnet watch`, Development) | http://localhost:5090/api/health | hot reload / reinicio |

- El código se monta desde tu disco. `node_modules`, `bin/obj`, los paquetes NuGet y los datos (SQLite, media, videos
  en proceso) viven en volúmenes del proyecto `blog-dev`: no se mezclan con los de Windows ni con la base de
  `dotnet run`. `docker compose -f infra/compose.dev.yml --env-file infra/local.env down -v` los borra (base incluida).
- El primer arranque baja dependencias (~1 min); los siguientes, ~20 s. Si cambia el `pnpm-lock.yaml`, el servicio
  `deps` reinstala solo al volver a levantar.
- Puertos ocupados (por ejemplo, porque también corrés los servidores sin Docker): cambiá los de tu PC con
  `API_PORT`, `ADMIN_PORT` y `WEB_PORT`, por ejemplo
  `API_PORT=15090 ADMIN_PORT=15173 WEB_PORT=14321 docker compose -f infra/compose.dev.yml --env-file infra/local.env up`.
  Los enlaces "Ver sitio" del admin siguen a `WEB_PORT`. El admin llega a la API por la red de compose (`API_URL`).
- Otra contraseña: generá un hash (ver abajo) y pegalo en `infra/local.env` (vale para el desarrollo y para la copia
  local). El token entre la API y el sitio (`BUILDER_TOKEN`) es de prueba; da igual cuál sea mientras tenga 32
  caracteres o más.
- Sin Docker, `pnpm dev:admin` usa `http://localhost:5090` (API) y `http://localhost:4321/` (sitio); `API_URL` y
  `SITE_URL` los cambian.

## Copia local de producción

El mismo `docker-compose.yml` del VPS (mismas imágenes, topes de memoria y volúmenes: Caddy + API + builder, sitio
estático, `/admin/`, `/media`) con un override para tu PC: HTTP sin TLS en http://localhost:8080 y valores de prueba en
`infra/local.env` (solo para tu PC; nunca en el VPS). Desde `infra/`:

```bash
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env up -d --build
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env logs -f builder   # primer build del sitio
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env down             # -v borra también los datos
```

http://localhost:8080/ → `/es/`; el admin en http://localhost:8080/admin/ con la contraseña `admin`. Si el 8080 está
ocupado: `LOCAL_PORT=18080 docker compose ...` (también ajusta `SITE_URL`). Recién levantado, `/api` responde 502
durante el segundo o dos que tarda en arrancar la API; Caddy la chequea cada 2 s.

Para cambiar la contraseña, generá el hash con la imagen de la API (ya construida por el `up --build`) y pegalo en
`local.env` entre comillas simples:

```bash
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env run --rm --no-deps api hash-password
```

## Cómo verificar

Lo mismo que corre CI (`.github/workflows/ci.yml`, en cada push y PR a `master`), desde la raíz del repo:

```bash
# Node (typecheck, tests de todos los workspaces + perfil + skills + infra, build del admin, skills sincronizadas)
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm --filter @blog/admin build && pnpm agents:check

# API: en el destino dev de su Dockerfile (SDK + el ffmpeg 9.1 fijado), así corren también los tests de ffmpeg. El
# código se monta de solo lectura y se copia adentro sin bin/, obj/ ni la base de desarrollo: no toca nada de tu PC.
docker build --target dev --tag blog-api-dev apps/api
docker run --rm --volume "$PWD/apps/api:/src:ro" blog-api-dev sh -euc \
  'mkdir /tmp/api && tar -C /src --exclude=bin --exclude=obj --exclude=./src/Blog.Api/data -cf - . | tar -C /tmp/api -xf - &&
   cd /tmp/api && dotnet build -warnaserror && dotnet test --no-build'

# Infra: los compose (el del VPS pide su .env; CI lo prueba con valores de mentira) y el Caddyfile con el Caddy de la imagen
docker compose -f infra/docker-compose.yml -f infra/compose.local.yml --env-file infra/local.env config -q
docker compose -f infra/compose.dev.yml --env-file infra/local.env config -q
docker run --rm -v "$PWD/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -e SITE_ADDRESS=:80 \
  "$(sed -n 's/^FROM \(caddy:[^ ]*\).*/\1/p' infra/caddy/Dockerfile)" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Seguridad: dependencias con vulnerabilidades conocidas
pnpm audit --prod --audit-level high
```

CI además construye las tres imágenes de producción (`docker compose build`, sin push) y las revisa con Trivy (CRITICAL y
HIGH con arreglo publicado), busca secretos en toda la historia con gitleaks y corre `dotnet list package --vulnerable
--include-transitive` con el SDK fijado. Dependabot (`.github/dependabot.yml`) propone cada semana las versiones nuevas
de pnpm, NuGet, imágenes base y acciones. Toda acción va fijada por SHA y toda imagen por digest.

En Windows se saltean los tests de los scripts de backup (son para Linux) y, sin el modo desarrollador, los del
builder que crean symlinks; en CI (Linux) corren todos.

## Operación (VPS)

Todos los comandos, desde `infra/` y con `--env-file .env` (sin él, compose dice qué variable falta y no hace nada).

### Primer deploy

1. Docker con el plugin compose, y el DNS del dominio apuntando a la IP del VPS.
2. `cp .env.example .env` y completalo (el `.env` no se versiona; nunca lo subas):
   - `SITE_ADDRESS` (el dominio, ej. `blog.midominio.com`) y `SITE_URL` (`https://` + dominio, sin barra final).
   - `BUILDER_TOKEN`: `openssl rand -hex 32` (la API exige 32 caracteres o más).
   - `ADMIN_PASSWORD_HASH`: el hash de la contraseña del admin, entre comillas simples (tiene `$`). La contraseña tiene
     que tener 12 caracteres o más; se escribe sin eco:

     ```bash
     docker build --tag blog-api ../apps/api && docker run --rm -it blog-api hash-password
     ```

   - `ACME_EMAIL` (opcional): correo para los avisos de Let's Encrypt (vencimientos, problemas con el certificado).
3. `docker compose --env-file .env up -d --build` y `docker compose --env-file .env ps` hasta ver `healthy` en `api` y
   `builder`. Caddy pide el certificado TLS solo al arrancar (con el DNS ya apuntando).
4. Entrá a `https://tu-dominio/admin/`, creá un post y publicalo. El primer build tarda; los siguientes tienen debounce y
   corren con `nice` y tope de heap para no pisar a las otras apps.

Si el VPS ya tiene otro reverse proxy en 80/443, no levantes este Caddy tal cual: poné el tuyo adelante y que apunte al
contenedor `caddy` por una red interna. La API no publica puertos: solo la alcanzan Caddy y el builder.

### Actualizar

```bash
sh backup.sh                                   # siempre antes: es el único camino de vuelta (ver Rollback)
git pull
docker compose --env-file .env up -d --build
docker compose --env-file .env ps              # api y builder vuelven a healthy
docker image prune -f                          # las imágenes viejas que quedaron sin nombre
```

Las migraciones de la base corren solas al arrancar la API. Un build fallido nunca toca el sitio publicado.

### Rollback

No hay migraciones `Down`: volver a una versión anterior es **restaurar el backup** hecho antes de actualizar. Primero el
código anterior (`git checkout <commit>` y `docker compose --env-file .env build`), después el backup de ese momento:

```bash
sh restore.sh /var/backups/blog/daily/<UTC>            # revisa el snapshot y muestra qué haría; no toca nada
sh restore.sh /var/backups/blog/daily/<UTC> --apply    # restaura, levanta todo, espera los healthchecks y pide un build
```

Lo que se publicó o editó después de ese backup se pierde, salvo en `BACKUP_DIR/pre-restore-<UTC>`: antes de cambiar
nada, `--apply` guarda ahí lo que había (se restaura con el mismo script; no se rota, borralo cuando no lo quieras).

### Backups

`backup.sh` copia la base (copia consistente hecha por la API mientras atiende), las claves de sesión y la media nueva a
`BACKUP_DIR` (por defecto `/var/backups/blog`), y rota 7 diarios y 4 semanales. Una vez por día con cron, del usuario que
maneja Docker:

```cron
15 3 * * * BACKUP_RCLONE_REMOTE=secreto:blog sh /ruta/al/repo/infra/backup.sh >> /var/log/blog-backup.log 2>&1
```

- Sin `BACKUP_RCLONE_REMOTE`, el backup queda solo en el VPS: si se pierde el disco, se pierde todo. Configurá una copia
  remota con rclone: un remote **`crypt`** (`rclone config` → crypt) encima del S3, B2, Drive… que uses. El backup tiene
  la base (con el hash del admin) y las claves de sesión: el script rechaza un remote sin cifrar salvo con
  `BACKUP_ALLOW_PLAINTEXT=1`. Sube con `rclone copy` (nunca borra allá por un borrado de acá); la configuración
  completa está al principio de `backup.sh` y `backup-common.sh`.
- Probá la restauración de vez en cuando: `sh restore.sh <snapshot>` (sin `--apply`) revisa que el snapshot esté sano.
- En un VPS nuevo: el repo, el `.env` del anterior (guardalo aparte: no está en el backup),
  `rclone copy "$BACKUP_RCLONE_REMOTE" /var/backups/blog`, `docker compose --env-file .env build` y `restore.sh` como arriba.

### Logs

```bash
docker compose --env-file .env logs -f --tail 100 api        # o caddy, builder
docker compose --env-file .env logs --no-log-prefix api | jq -R 'fromjson? // empty'   # la API escribe JSON
```

Tienen tope: driver `local`, como mucho 5 archivos de 10 MB por contenedor (no llenan el disco). Los logins fallidos
quedan en el log de la API con la IP. El admin no muestra el estado de los builds: un build fallido está en
`logs builder` (y el sitio publicado sigue siendo el anterior).

### Healthchecks

- `api`: `dotnet Blog.Api.dll healthcheck` pide `/api/health/ready` (200 si SQLite responde, si no 503). `/api/health`
  solo dice que el proceso vive; es el que usa Caddy para sacar a la API del balanceo.
- `builder`: `node src/healthcheck.ts` pide su `GET /health`. Arranca cuando la API está sana (`service_healthy`).
- `caddy`: arranca apenas la API arrancó (`service_started`), sin esperar a que esté sana: el sitio estático nunca
  depende de la API.

`docker compose --env-file .env ps` muestra el estado; un servicio `unhealthy` sigue corriendo (Docker no lo reinicia):
mirá sus logs.

### Rotar la contraseña del admin y el token del builder

- Contraseña: generá el hash nuevo (como en el primer deploy), reemplazá `ADMIN_PASSWORD_HASH` en `.env` y
  `docker compose --env-file .env up -d api`. Después entrá al admin con la contraseña nueva y cerrá sesión: cerrar
  sesión invalida todas las sesiones abiertas (también una cookie copiada).
- Token: `openssl rand -hex 32`, reemplazá `BUILDER_TOKEN` en `.env` y `docker compose --env-file .env up -d` (la API y
  el builder lo leen al arrancar).

### Firewall

Abiertos solo SSH, 80/tcp y 443 (tcp y udp, HTTP/3). Por ejemplo con ufw: `ufw allow OpenSSH`, `ufw allow 80/tcp`,
`ufw allow 443`, `ufw enable` (o el firewall del proveedor del VPS). Ojo: Docker abre en iptables los puertos que
publica sin pasar por ufw; acá solo los publica Caddy (80 y 443).

### Disco

- `docker system df` muestra imágenes, caché de build y volúmenes. Después de varias actualizaciones:
  `docker system prune` (contenedores parados, imágenes sin nombre, caché de build). **Nunca** `--volumes` ni
  `down -v`: borran la base y la media.
- La media (`media`) crece con cada imagen y video subido (de cada imagen se guardan varios anchos en AVIF y WebP) y no
  se borra sola; el backup la acumula igual. El builder guarda las 3 últimas versiones del sitio (`KEEP_RELEASES`).

### Monitoreo

No hay monitoreo interno. Configurá un chequeo externo de disponibilidad (cualquier servicio de uptime) con aviso por
correo sobre:

- `https://tu-dominio/` (el sitio estático: lo que ven los visitantes),
- `https://tu-dominio/api/health/ready` (la API y la base: el admin),
- el vencimiento del certificado TLS (Caddy lo renueva solo; el aviso avisa si la renovación falla).

## Seguridad (lo que está implementado)

- Cookie de sesión `__Host-admin`: HttpOnly, SameSite=Strict, Secure, 12 h. Cerrar sesión invalida todas las sesiones
  emitidas (época de sesiones en la base).
- Contraseña con PBKDF2-SHA256 (600k iteraciones), de 12 caracteres o más; en el `.env` va solo el hash.
- CSRF: header obligatorio `X-Requested-With: blog-admin` en las rutas de admin.
- Rate limit de login: 10 intentos / 15 min por IP (la IP real: `X-Forwarded-For` solo se cree si viene de las redes de
  Docker, `ForwardedHeaders:KnownNetworks`).
- Subida de imágenes validada por *magic bytes* (PNG, JPG, GIF, WebP, AVIF), máx. 8 MB; SVG rechazado a propósito.
- Videos (MP4, MOV, WebM, MKV) validados por *magic bytes* y ffprobe, máx. 200 MB y 15 s; el original (con audio y
  metadatos) nunca llega a `/media`.
- El Markdown **no admite HTML crudo** (todo se escapa) y las URLs pasan por allowlist (`http`, `https`, `mailto`, `tel`, relativas).
- `/api/internal` (usado por el builder) exige Bearer y Caddy lo bloquea hacia afuera.
- Contenedores con `no-new-privileges`, sin capacidades de Linux salvo las necesarias, `pids_limit` y topes de memoria;
  Caddy y la API con sistema de archivos de solo lectura; la API y el builder no corren como root (Caddy sí, pero solo
  con la capacidad de abrir los puertos 80/443). Imágenes base fijadas por digest.
- Un build fallido **no toca** el sitio publicado.

## Licencia

El código es [MIT](../LICENSE). Los posts, las fotos, los videos y las referencias de diseño no están cubiertos por esa
licencia: todos los derechos reservados.
