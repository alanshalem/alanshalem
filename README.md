# Blog

Blog propio con editor Markdown, pensado para un VPS chico compartido con otras apps.

## Cómo está armado

```
Visitante ──► Caddy ──► archivos estáticos (HTML precomprimido en br/gzip)
                 │
                 ├─ /media/*   imágenes subidas (cache inmutable)
                 ├─ /admin/*   SPA de administración (React)
                 └─ /api/*     API .NET  (/api/internal está bloqueado desde afuera)

Admin ──► API ──► SQLite
              └─ al publicar ──► Builder ──► astro build ──► releases/<timestamp>/ ──► symlink `current` (swap atómico)
```

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
| `infra` | `docker-compose.yml`, `Caddyfile`, Dockerfile de Caddy (que también compila el admin). |

## Desarrollo local

Requisitos: Node ≥ 22.12, pnpm 10, .NET SDK 10.

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

Si el VPS ya tiene otro reverse proxy en 80/443, no levantes este Caddy tal cual: poné el tuyo adelante y que apunte
al contenedor `caddy` por una red interna.

## Seguridad (lo que está implementado)

- Cookie de sesión `__Host-admin`: HttpOnly, SameSite=Strict, Secure, 12 h.
- Contraseña con PBKDF2-SHA256 (600k iteraciones); en el `.env` va solo el hash.
- CSRF: header obligatorio `X-Requested-With: blog-admin` en las rutas de admin.
- Rate limit de login: 10 intentos / 15 min por IP.
- Subida de imágenes validada por *magic bytes* (PNG, JPG, GIF, WebP, AVIF), máx. 8 MB; SVG rechazado a propósito.
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

1. `pnpm install` y commitear `pnpm-lock.yaml` (los Dockerfiles hoy usan `pnpm install` sin `--frozen-lockfile`).
2. `pnpm typecheck && pnpm test`, y `dotnet test` en `apps/api`. Corregir lo que salga.
3. Agregar las fuentes en `apps/web/public/fonts/` (Gloock, Pagella, Hanken Grotesk en `.woff2`). Faltan las Pagella; mientras tanto se usa la cadena de fallback.
4. Probar `pnpm build:web` con la API corriendo.
5. Deploy y medir con `docker stats`: los límites de memoria del compose son topes, no consumo medido.

## Limitaciones de la v0.1

- Sitio monolingüe (el campo `lang` se guarda, por defecto `es`, pero no se usa para rutas).
- Sin paginación en `/articulos/`.
- La base se crea con `EnsureCreated`; cuando el esquema empiece a cambiar hay que pasar a migraciones de EF Core.
- Markdown sin HTML crudo, títulos setext, notas al pie ni listas de tareas.
- Sin backups automáticos: respaldá los volúmenes `api_data` y `media`.
