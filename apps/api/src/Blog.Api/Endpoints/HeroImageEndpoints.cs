using Blog.Api.Security;
using Blog.Application.HeroImages;

namespace Blog.Api.Endpoints;

public static class HeroImageEndpoints
{
    /// <summary>Galería del hero dentro del grupo /api/admin. Cada cambio pide un rebuild (la galería se ve en la home).</summary>
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

        // Solo saca la foto de la galería: los archivos del asset quedan (pueden estar usados en posts).
        heroImages.MapDelete("/{id:guid}", async (Guid id, HeroImageService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        return admin;
    }

    /// <summary>
    /// Lo que lee el builder, ordenado por fecha de alta: la primera es la de &lt;noscript&gt; y og:image. Solo fotos
    /// y videos listos.
    /// </summary>
    public static IEndpointRouteBuilder MapInternalHeroImageEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/internal/hero-images", (HeroImageService service, CancellationToken ct) => service.ListForSiteAsync(ct))
            .AddEndpointFilter<BuilderTokenFilter>();

        return app;
    }
}
