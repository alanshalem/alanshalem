# Blog

Blog propio con editor Markdown, pensado para un VPS chico compartido con otras apps.

## Cómo está armado

```
Visitante ──► Caddy ──► archivos estáticos (HTML precomprimido en br/gzip)
                 │
                 ├─ /media/*   imágenes y videos subidos (cache inmutable, Range)
                 ├─ /admin/*   SPA de administración (React)
                 └─ /api/*     API .NET  (/api/internal está bloqueado desde afuera)

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
| `infra` | `docker-compose.yml` (VPS), `compose.local.yml` + `local.env` (copia local), `compose.dev.yml` (desarrollo), `Caddyfile`, Dockerfile de Caddy (que también compila el admin). |

## Desarrollo local

Requisitos: Node ≥ 22.12, pnpm 10, .NET SDK 10 y, para los videos del hero, `ffmpeg` y `ffprobe` con `libsvtav1`
(SVT-AV1 4.x, con el que se calibró la codificación) y `libx264`. La API los busca en el PATH; si no, configurá
`Video:FfmpegPath` y `Video:FfprobePath`. Los videos en proceso quedan en `Video:WorkDirectory` (por defecto
`data/video-work`, nunca dentro de `Media:Directory`). libvips no hace falta: viene en el paquete NuGet.

```bash
pnpm install            # y commiteá el pnpm-lock.yaml (ver "Primer arranque")
pnpm test               # tests de markdown, editor y builder
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
docker compose -f infra/compose.dev.yml up --build     # Ctrl+C para cortar; `down` para borrar los contenedores
```

| Qué | URL | Recarga en vivo |
|---|---|---|
| Admin (Vite) | http://localhost:5173/admin/ — contraseña `admin` | HMR al guardar |
| Sitio (`astro dev`) | http://localhost:4321/ | recarga la página |
| API (`dotnet watch`, Development) | http://localhost:5090/api/health | hot reload / reinicio |

- El código se monta desde tu disco. `node_modules`, `bin/obj`, los paquetes NuGet y los datos (SQLite, media, videos
  en proceso) viven en volúmenes del proyecto `blog-dev`: no se mezclan con los de Windows ni con la base de
  `dotnet run`. `docker compose -f infra/compose.dev.yml down -v` los borra (base incluida).
- El primer arranque baja dependencias (~1 min); los siguientes, ~20 s. Si cambia el `pnpm-lock.yaml`, el servicio
  `deps` reinstala solo al volver a levantar.
- Puertos ocupados (por ejemplo, porque también corrés los servidores sin Docker): cambiá los de tu PC con
  `API_PORT`, `ADMIN_PORT` y `WEB_PORT`, por ejemplo `API_PORT=15090 ADMIN_PORT=15173 WEB_PORT=14321 docker compose -f infra/compose.dev.yml up`.
  Los enlaces "Ver sitio" del admin siguen apuntando a `localhost:4321`.
- Otra contraseña: generá un hash (ver abajo) y exportalo antes de levantar:
  `export ADMIN_PASSWORD_HASH='pbkdf2-sha256$...'`. El token entre la API y el sitio (`BUILDER_TOKEN`) tiene un
  valor de prueba por defecto; da igual cuál sea mientras tenga 32 caracteres o más.

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
ocupado: `LOCAL_PORT=18080 docker compose ...` (también ajusta `SITE_URL`). Recién levantado, `/api` puede responder
503 hasta ~30 s: Caddy espera el primer chequeo de salud de la API.

Para cambiar la contraseña, generá el hash con la imagen de la API (ya construida por el `up --build`) y pegalo en
`local.env` entre comillas simples:

```bash
docker compose -f docker-compose.yml -f compose.local.yml --env-file local.env run --rm --no-deps api hash-password
```

## Deploy en el VPS

Desde `infra/`:

```bash
cp .env.example .env
openssl rand -hex 32                      # → BUILDER_TOKEN
# Hash de la contraseña del admin (en comillas simples dentro del .env, por los $):
docker run --rm -it -v "$PWD/..:/src" -w /src/apps/api mcr.microsoft.com/dotnet/sdk:10.0 \
  dotnet run --project src/Blog.Api -- hash-password
# completá SITE_ADDRESS y SITE_URL, y apuntá el DNS a la IP del VPS

docker compose --env-file .env up -d --build
docker compose logs -f
```

Entrás a `https://tu-dominio/admin/`, creás un post y lo publicás. El primer build tarda; los siguientes están
con debounce y corren con `nice` y tope de heap para no pisar a las otras apps.

La imagen de la API ya trae ffmpeg 9.1 estático (SVT-AV1 4.3 + x264, fijado por digest en `apps/api/Dockerfile`) y
el compose pone `Video__WorkDirectory` en el volumen `api_data`. Codificar un video pide memoria: la API tiene tope de
1,5 GB y 2 CPUs (medido, ver el comentario en `docker-compose.yml`); en reposo usa ~85 MB.

Si el VPS ya tiene otro reverse proxy en 80/443, no levantes este Caddy tal cual: poné el tuyo adelante y que apunte
al contenedor `caddy` por una red interna.

## Seguridad (lo que está implementado)

- Cookie de sesión `__Host-admin`: HttpOnly, SameSite=Strict, Secure, 12 h.
- Contraseña con PBKDF2-SHA256 (600k iteraciones); en el `.env` va solo el hash.
- CSRF: header obligatorio `X-Requested-With: blog-admin` en las rutas de admin.
- Rate limit de login: 10 intentos / 15 min por IP.
- Subida de imágenes validada por *magic bytes* (PNG, JPG, GIF, WebP, AVIF), máx. 8 MB; SVG rechazado a propósito.
- Videos (MP4, MOV, WebM, MKV) validados por *magic bytes* y ffprobe, máx. 200 MB y 15 s; el original (con audio y
  metadatos) nunca llega a `/media`.
- El Markdown **no admite HTML crudo** (todo se escapa) y las URLs pasan por allowlist (`http`, `https`, `mailto`, `tel`, relativas).
- `/api/internal` (usado por el builder) exige Bearer y Caddy lo bloquea hacia afuera.
- Un build fallido **no toca** el sitio publicado.

## Estado: qué se verificó y qué no

Este código se escribió en un entorno sin red y sin .NET, así que:

**Verificado corriendo tests**
- `packages/markdown`: 65 tests OK.
- Lógica del editor (`apps/admin/test`): 48 tests OK.
- `apps/builder`: 19 tests OK, incluyendo un build de punta a punta con un `pnpm` falso y el swap atómico con lecturas concurrentes.
- Lógica de `apps/web/src/lib/posts.ts` contra una API simulada.
- Sintaxis válida de todos los JSON / XML / YAML.

**Escrito pero NUNCA compilado ni ejecutado**
- La API .NET y sus 37 tests xUnit.
- El build de Astro (páginas, RSS, sitemap).
- El admin React/Vite (componentes, `tsc`, `vite build`).
- Docker, docker-compose y Caddyfile.

Esperá errores de compilación o de integración en el primer arranque; son esperables y suelen ser chicos.

## Primer arranque: checklist

1. `pnpm install` y commitear `pnpm-lock.yaml` (los Dockerfiles instalan con `--frozen-lockfile`: sin un lockfile al día, el build falla).
2. `pnpm typecheck && pnpm test`, y `dotnet test` en `apps/api`. Corregir lo que salga.
3. Fuentes: Gloock y Hanken Grotesk salen de npm (`pnpm --filter @blog/web fonts`); las Pagella (TeX Gyre Pagella, GUST) ya están versionadas en `apps/web/public/fonts/` (ver `LICENSES.txt`).
4. Probar `pnpm build:web` con la API corriendo.
5. Deploy y medir con `docker stats`: los límites de memoria del compose son topes, no consumo medido.

## Limitaciones de la v0.1

- Sitio monolingüe (el campo `lang` se guarda, por defecto `es`, pero no se usa para rutas).
- Sin paginación en `/articulos/`.
- La base se crea con `EnsureCreated`; cuando el esquema empiece a cambiar hay que pasar a migraciones de EF Core.
- Markdown sin HTML crudo, títulos setext, notas al pie ni listas de tareas.
- Sin backups automáticos: respaldá los volúmenes `api_data` y `media`.
