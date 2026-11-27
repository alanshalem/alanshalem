using Blog.Application.HeroImages;

namespace Blog.Api.Endpoints;

public static class HeroImageEndpoints
{
    /// <summary>Hero gallery inside the /api/admin group. Every change requests a rebuild (the gallery shows on the home page).</summary>
    public static RouteGroupBuilder MapAdminHeroImageEndpoints(this RouteGroupBuilder admin)
    {
        var heroImages = admin.MapGroup("/hero-images");
        heroImages.MapGet("/", (HeroImageService service, CancellationToken ct) => service.ListAsync(ct));

        heroImages.MapPost("/", async (CreateHeroImageRequest request, HeroImageService service, CancellationToken ct) =>
        {
            var image = await service.CreateAsync(request, ct);
            return Results.Created($"/api/admin/hero-images/{image.Id}", image);
        });

        heroImages.MapPut("/{id:guid}", (Guid id, UpdateHeroImageRequest request, HeroImageService service, CancellationToken ct) =>
            service.UpdateAsync(id, request, ct));

        // Only removes the photo from the gallery: the asset's files stay (they may be used in posts).
        heroImages.MapDelete("/{id:guid}", async (Guid id, HeroImageService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        return admin;
    }

    /// <summary>
    /// What the builder reads, sorted by date added: the first one is the one of &lt;noscript&gt; and og:image. Only
    /// photos and ready videos. Inside the /api/internal group (builder token).
    /// </summary>
    public static RouteGroupBuilder MapInternalHeroImageEndpoints(this RouteGroupBuilder builderOnly)
    {
        builderOnly.MapGet("/hero-images", (HeroImageService service, CancellationToken ct) => service.ListForSiteAsync(ct));

        return builderOnly;
    }
}
