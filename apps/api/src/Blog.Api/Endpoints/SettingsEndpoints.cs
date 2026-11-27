using Blog.Application.Settings;

namespace Blog.Api.Endpoints;

public static class SettingsEndpoints
{
    /// <summary>Site settings inside the /api/admin group (session cookie + the middleware's anti-CSRF header).</summary>
    public static RouteGroupBuilder MapAdminSettingsEndpoints(this RouteGroupBuilder admin)
    {
        var settings = admin.MapGroup("/settings");
        settings.MapGet("/", (SiteSettingsService service, CancellationToken ct) => service.GetAsync(ct));

        // Saves and requests a rebuild: name, bio and links appear on every page of the site.
        settings.MapPut("/", (SaveSiteSettingsRequest request, SiteSettingsService service, CancellationToken ct) =>
            service.SaveAsync(request, ct));

        return admin;
    }

    /// <summary>What the Astro builder reads, inside the /api/internal group (builder token).</summary>
    public static RouteGroupBuilder MapInternalSettingsEndpoints(this RouteGroupBuilder builderOnly)
    {
        builderOnly.MapGet("/settings", (SiteSettingsService service, CancellationToken ct) => service.GetAsync(ct));

        return builderOnly;
    }
}
