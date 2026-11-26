# syntax=docker/dockerfile:1
# Contexto de build: apps/api. Dos destinos con la misma base (SDK) y el mismo ffmpeg:
#   runtime (el último, el que usa docker-compose.yml): la imagen de producción.
#   dev (compose.dev.yml): SDK + ffmpeg para `dotnet watch`, con el código montado desde tu disco.

# ffmpeg y ffprobe estáticos (sin dependencias del sistema): 9.1 con SVT-AV1 4.3.0 y x264. El digest fija los bytes
# exactos (Docker los verifica al bajarlos). Ubuntu 24.04 trae ffmpeg 6.1 con SVT-AV1 1.7: los parámetros de
# FfmpegVideoTranscoder se calibraron con SVT-AV1 4.x, y el paquete suma ~580 MB de dependencias contra ~290 MB de estos.
# Para actualizar: elegir un tag nuevo de https://hub.docker.com/r/mwader/static-ffmpeg y poner su digest.
FROM mwader/static-ffmpeg:9.1@sha256:dd09509d8c2152bfa601c8c20e3dd166bde906d37951b9f7e8bbd922267f5ac9 AS ffmpeg

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS sdk
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

# ---------- Desarrollo ----------
# Sin COPY del código: compose.dev.yml monta apps/api y guarda bin/obj y los paquetes NuGet en volúmenes.
FROM sdk AS dev
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /repo/apps/api
ENV ASPNETCORE_URLS=http://+:5090
# --no-launch-profile: el entorno y la URL salen de las variables de arriba y de compose.dev.yml, no de launchSettings
# (que escucha en localhost y desde fuera del contenedor no se llegaría).
CMD ["dotnet", "watch", "--project", "src/Blog.Api", "--non-interactive", "--no-launch-profile"]

# ---------- Producción ----------
FROM sdk AS build
WORKDIR /src

# Primero solo los .csproj y props: la capa de `restore` queda cacheada mientras no cambien las dependencias, y la caché
# de NuGet (montada, no queda en la imagen) evita volver a bajar los paquetes que no cambiaron cuando sí cambian.
COPY global.json Directory.Build.props Directory.Packages.props Blog.slnx ./
COPY src/Blog.Domain/Blog.Domain.csproj src/Blog.Domain/
COPY src/Blog.Application/Blog.Application.csproj src/Blog.Application/
COPY src/Blog.Infrastructure/Blog.Infrastructure.csproj src/Blog.Infrastructure/
COPY src/Blog.Api/Blog.Api.csproj src/Blog.Api/
# -r linux-x64: solo las bibliotecas nativas de esta plataforma (libvips, SQLite); sin él se copian las de todas (~50 MB).
RUN --mount=type=cache,id=blog-nuget,target=/root/.nuget/packages \
    dotnet restore src/Blog.Api/Blog.Api.csproj -r linux-x64

COPY src/ src/
# Sin --no-restore a propósito: la capa de restore puede seguir cacheada aunque BuildKit haya purgado la caché de NuGet
# (`docker builder prune`), y entonces faltan los paquetes. Con la caché intacta, este restore no hace nada (segundos);
# si se purgó, vuelve a bajar lo que falta en vez de fallar hasta un `--no-cache`.
RUN --mount=type=cache,id=blog-nuget,target=/root/.nuget/packages \
    dotnet publish src/Blog.Api/Blog.Api.csproj -c Release -o /app -r linux-x64 --self-contained false -p:UseAppHost=false

# Ubuntu (glibc, no Alpine): trae ICU, necesario para normalizar acentos al generar slugs, y lo que necesita la libvips
# que viene en NetVips.Native.linux-x64.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_gcServer=0 \
    DOTNET_TieredPGO=0

# Usuario sin privilegios (viene incluido en las imágenes oficiales de .NET).
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Blog.Api.dll"]
