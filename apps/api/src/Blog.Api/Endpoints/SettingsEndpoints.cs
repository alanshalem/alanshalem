using Blog.Api.Security;
using Blog.Application.Settings;

namespace Blog.Api.Endpoints;

public static class SettingsEndpoints
{
    /// <summary>Ajustes del sitio dentro del grupo /api/admin (cookie de sesión + cabecera anti-CSRF del middleware).</summary>
    public static RouteGroupBuilder MapAdminSettingsEndpoints(this RouteGroupBuilder admin)
    {
        var settings = admin.MapGroup("/settings");
        settings.MapGet("/", (SiteSettingsService service, CancellationToken ct) => service.GetAsync(ct));

        // Guarda y pide un rebuild: nombre, bio y enlaces aparecen en todas las páginas del sitio.
        settings.MapPut("/", (SaveSiteSettingsRequest request, SiteSettingsService service, CancellationToken ct) =>
            service.SaveAsync(request, ct));

        return admin;
    }

    /// <summary>Lo que lee el builder de Astro, con el mismo token que /api/internal/posts.</summary>
    public static IEndpointRouteBuilder MapInternalSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/internal/settings", (SiteSettingsService service, CancellationToken ct) => service.GetAsync(ct))
            .AddEndpointFilter<BuilderTokenFilter>();

        return app;
    }
}
