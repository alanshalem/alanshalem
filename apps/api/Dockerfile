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
RUN dotnet restore src/Blog.Api/Blog.Api.csproj

COPY src/ src/
RUN dotnet publish src/Blog.Api/Blog.Api.csproj -c Release -o /app --no-restore -p:UseAppHost=false

# Imagen Debian (no Alpine): trae ICU, necesario para normalizar acentos al generar slugs.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_gcServer=0 \
    DOTNET_TieredPGO=0

# Usuario sin privilegios (viene incluido en las imágenes oficiales de .NET).
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Blog.Api.dll"]
