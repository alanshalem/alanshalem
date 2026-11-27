# syntax=docker/dockerfile:1
# Build context: apps/api. Two targets with the same base (SDK) and the same ffmpeg:
#   runtime (the last one, used by docker-compose.yml): the production image.
#   dev (compose.dev.yml): SDK + ffmpeg for `dotnet watch`, with the code mounted from your disk.

# Static ffmpeg and ffprobe (no system dependencies): 9.1 with SVT-AV1 4.3.0 and x264. The digest pins the exact bytes
# (Docker verifies them when pulling). Ubuntu 24.04 ships ffmpeg 6.1 with SVT-AV1 1.7: the FfmpegVideoTranscoder
# parameters were calibrated with SVT-AV1 4.x, and the package adds ~580 MB of dependencies against ~290 MB for these.
# To update: pick a new tag from https://hub.docker.com/r/mwader/static-ffmpeg and set its digest.
FROM mwader/static-ffmpeg:9.1@sha256:dd09509d8c2152bfa601c8c20e3dd166bde906d37951b9f7e8bbd922267f5ac9 AS ffmpeg

# Base images pinned by digest (exact bytes, verified when pulling): a rebuild does not change version on its own. To
# update: new tag and its digest with `docker buildx imagetools inspect <image:tag>`. SDK and runtime use the same .NET
# version (11.0.0).
FROM mcr.microsoft.com/dotnet/sdk:11.0.100@sha256:2794448a07118a6eaf00f29ab5d2bf44928517ce5ff86505a63a69230374f599 AS sdk
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

# ---------- Development ----------
# No COPY of the code: compose.dev.yml mounts apps/api and keeps bin/obj and the NuGet packages in volumes.
FROM sdk AS dev
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /repo/apps/api
ENV ASPNETCORE_URLS=http://+:5090
# --no-launch-profile: the environment and the URL come from the variables above and from compose.dev.yml, not from
# launchSettings (which listens on localhost and could not be reached from outside the container).
CMD ["dotnet", "watch", "--project", "src/Blog.Api", "--non-interactive", "--no-launch-profile"]

# ---------- Production ----------
FROM sdk AS build
WORKDIR /src

# First only the .csproj and props files: the `restore` layer stays cached while the dependencies do not change, and the
# NuGet cache (mounted, not kept in the image) avoids downloading again the packages that did not change when they do.
COPY global.json Directory.Build.props Directory.Packages.props Blog.slnx ./
COPY src/Blog.Domain/Blog.Domain.csproj src/Blog.Domain/
COPY src/Blog.Application/Blog.Application.csproj src/Blog.Application/
COPY src/Blog.Infrastructure/Blog.Infrastructure.csproj src/Blog.Infrastructure/
COPY src/Blog.Api/Blog.Api.csproj src/Blog.Api/
# -r linux-x64: only the native libraries of this platform (libvips, SQLite); without it those of every platform are copied (~50 MB).
RUN --mount=type=cache,id=blog-nuget,target=/root/.nuget/packages \
    dotnet restore src/Blog.Api/Blog.Api.csproj -r linux-x64

COPY src/ src/
# No --no-restore on purpose: the restore layer may still be cached even if BuildKit purged the NuGet cache
# (`docker builder prune`), and then the packages are missing. With the cache intact, this restore does nothing
# (seconds); if it was purged, it downloads what is missing instead of failing until a `--no-cache`.
RUN --mount=type=cache,id=blog-nuget,target=/root/.nuget/packages \
    dotnet publish src/Blog.Api/Blog.Api.csproj -c Release -o /app -r linux-x64 --self-contained false -p:UseAppHost=false

# Ubuntu (glibc, not Alpine): it ships ICU, needed to normalize accents when generating slugs, and what the libvips that
# comes in NetVips.Native.linux-x64 needs.
FROM mcr.microsoft.com/dotnet/aspnet:11.0.0@sha256:ca396ece3f2a2e62c7a03f1d7d710b8bc7e8c9dea5597d091178d9f5bfca13f0 AS runtime
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_gcServer=0 \
    DOTNET_TieredPGO=0

# Unprivileged user (included in the official .NET images).
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Blog.Api.dll"]
