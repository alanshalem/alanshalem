using Blog.Application.Media;
using Blog.Application.Videos;
using Blog.Domain;
using Blog.Infrastructure.Media;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

namespace Blog.Api.Endpoints;

public static class MediaEndpoints
{
    // Margen para la envoltura multipart (cabeceras y separadores) por encima del máximo del archivo: así un video
    // apenas más grande que el máximo recibe el mensaje propio del caso de uso (en el idioma del admin), no un 413 genérico.
    private const long MultipartMargin = 1024 * 1024;
    private const long VideoRequestLimit = VideoService.MaxBytes + MultipartMargin;

    /// <summary>Subida de imágenes y videos dentro del grupo /api/admin.</summary>
    public static RouteGroupBuilder MapAdminMediaEndpoints(this RouteGroupBuilder admin)
    {
        // La protección CSRF de ASP.NET (antiforgery) se reemplaza por la cabecera X-Requested-With que exige el middleware.
        // Devuelve el asset optimizado (conserva "url").
        admin.MapPost("/media", async (IFormFile file, MediaService media, CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                return await media.UploadImageAsync(stream, ct);
            })
            .DisableAntiforgery();

        // 202: el video queda validado y en cola; el admin consulta GET .../videos/{id} hasta que esté listo. El límite
        // de 200 MB se sube solo en esta ruta (el resto de la API sigue con el de Kestrel). ASP.NET guarda en disco
        // todo archivo de más de 64 KB al leer el formulario, así que la subida nunca queda entera en memoria.
        // Recorte y fundido son campos opcionales del mismo formulario, como texto: los lee y valida el caso de uso.
        admin.MapPost("/media/videos", async (
                IFormFile file,
                [FromForm] string? trimStart,
                [FromForm] string? trimEnd,
                [FromForm] string? fade,
                [FromForm] string? fadeSeconds,
                VideoService videos,
                CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                var video = await videos.UploadAsync(stream, new VideoEditInput(trimStart, trimEnd, fade, fadeSeconds), ct);
                return Results.Accepted($"/api/admin/media/videos/{video.Id}", video);
            })
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(VideoRequestLimit))
            .WithFormOptions(multipartBodyLengthLimit: VideoRequestLimit);

        admin.MapGet("/media/videos/{id:guid}", (Guid id, VideoService videos, CancellationToken ct) => videos.GetAsync(id, ct));

        return admin;
    }

    /// <summary>
    /// Todas las imágenes subidas, para que el builder arme el srcset de cualquier /media/... del sitio. Dentro del
    /// grupo /api/internal (token del builder).
    /// </summary>
    public static RouteGroupBuilder MapInternalMediaEndpoints(this RouteGroupBuilder builderOnly)
    {
        builderOnly.MapGet("/media", (MediaService media, CancellationToken ct) => media.ListAsync(ct));

        return builderOnly;
    }

    /// <summary>
    /// Solo en Development: la API sirve la carpeta de media para que el admin muestre las vistas previas.
    /// En producción /media lo sirve Caddy directo del volumen, con caché inmutable.
    /// </summary>
    public static WebApplication UseDevelopmentMediaFiles(this WebApplication app)
    {
        var directory = Path.GetFullPath(app.Services.GetRequiredService<IOptions<MediaOptions>>().Value.Directory);
        Directory.CreateDirectory(directory); // PhysicalFileProvider exige que la carpeta exista

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(directory),
            RequestPath = WebUrl.MediaPrefix.TrimEnd('/'),
        });

        return app;
    }
}
