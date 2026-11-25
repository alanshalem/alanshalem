using Blog.Api.Security;
using Blog.Application.Media;
using Blog.Domain;
using Blog.Infrastructure.Media;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

namespace Blog.Api.Endpoints;

public static class MediaEndpoints
{
    /// <summary>Subida de imágenes dentro del grupo /api/admin. Devuelve el asset optimizado (conserva "url").</summary>
    public static RouteGroupBuilder MapAdminMediaEndpoints(this RouteGroupBuilder admin)
    {
        // La protección CSRF de ASP.NET (antiforgery) se reemplaza por la cabecera X-Requested-With que exige el middleware.
        admin.MapPost("/media", async (IFormFile file, MediaService media, CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                return await media.UploadImageAsync(stream, ct);
            })
            .DisableAntiforgery();

        return admin;
    }

    /// <summary>Todas las imágenes subidas, para que el builder arme el srcset de cualquier /media/... del sitio.</summary>
    public static IEndpointRouteBuilder MapInternalMediaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/internal/media", (MediaService media, CancellationToken ct) => media.ListAsync(ct))
            .AddEndpointFilter<BuilderTokenFilter>();

        return app;
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
