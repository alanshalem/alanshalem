# syntax=docker/dockerfile:1
# Contexto de build: apps/api

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Primero solo los .csproj y props: la capa de `restore` queda cacheada mientras no cambien las dependencias.
COPY global.json Directory.Build.props Directory.Packages.props Blog.slnx ./
COPY src/Blog.Domain/Blog.Domain.csproj src/Blog.Domain/
COPY src/Blog.Application/Blog.Application.csproj src/Blog.Application/
COPY src/Blog.Infrastructure/Blog.Infrastructure.csproj src/Blog.Infrastructure/
COPY src/Blog.Api/Blog.Api.csproj src/Blog.Api/
# -r linux-x64: solo las bibliotecas nativas de esta plataforma (libvips, SQLite); sin él se copian las de todas (~50 MB).
RUN dotnet restore src/Blog.Api/Blog.Api.csproj -r linux-x64

COPY src/ src/
RUN dotnet publish src/Blog.Api/Blog.Api.csproj -c Release -o /app --no-restore -r linux-x64 --self-contained false -p:UseAppHost=false

# ffmpeg y ffprobe estáticos (sin dependencias del sistema): 9.1 con SVT-AV1 4.3.0 y x264. El digest fija los bytes
# exactos (Docker los verifica al bajarlos). Ubuntu 24.04 trae ffmpeg 6.1 con SVT-AV1 1.7: los parámetros de
# FfmpegVideoTranscoder se calibraron con SVT-AV1 4.x, y el paquete suma ~580 MB de dependencias contra ~290 MB de estos.
# Para actualizar: elegir un tag nuevo de https://hub.docker.com/r/mwader/static-ffmpeg y poner su digest.
FROM mwader/static-ffmpeg:9.1@sha256:dd09509d8c2152bfa601c8c20e3dd166bde906d37951b9f7e8bbd922267f5ac9 AS ffmpeg

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
