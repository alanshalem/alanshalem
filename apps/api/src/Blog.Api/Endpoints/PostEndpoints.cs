using Blog.Api.Security;
using Blog.Application.Media;
using Blog.Application.Posts;

namespace Blog.Api.Endpoints;

public static class PostEndpoints
{
    public static IEndpointRouteBuilder MapPostEndpoints(this IEndpointRouteBuilder app)
    {
        // ----- Admin: requiere la cookie de sesión -----
        var admin = app.MapGroup("/api/admin").RequireAuthorization();

        var posts = admin.MapGroup("/posts");
        posts.MapGet("/", (PostService service, CancellationToken ct) => service.ListAsync(ct));
        posts.MapGet("/{id:guid}", (Guid id, PostService service, CancellationToken ct) => service.GetAsync(id, ct));

        posts.MapPost("/", async (SavePostRequest request, PostService service, CancellationToken ct) =>
        {
            var post = await service.CreateAsync(request, ct);
            return Results.Created($"/api/admin/posts/{post.Id}", post);
        });

        posts.MapPut("/{id:guid}", (Guid id, SavePostRequest request, PostService service, CancellationToken ct) =>
            service.UpdateAsync(id, request, ct));

        posts.MapPost("/{id:guid}/publish", (Guid id, PostService service, CancellationToken ct) =>
            service.PublishAsync(id, ct));

        posts.MapPost("/{id:guid}/unpublish", (Guid id, PostService service, CancellationToken ct) =>
            service.UnpublishAsync(id, ct));

        posts.MapDelete("/{id:guid}", async (Guid id, PostService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        // La protección CSRF de ASP.NET (antiforgery) se reemplaza por la cabecera X-Requested-With que exige el middleware.
        admin.MapPost("/media", async (IFormFile file, MediaService media, CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                var url = await media.UploadImageAsync(stream, ct);
                return Results.Ok(new { url });
            })
            .DisableAntiforgery();

        admin.MapAdminSettingsEndpoints();

        // ----- Interno: lo consume el builder de Astro, con token. Caddy no lo expone hacia afuera. -----
        app.MapGet("/api/internal/posts", (PostService service, CancellationToken ct) => service.ListPublishedAsync(ct))
            .AddEndpointFilter<BuilderTokenFilter>();
        app.MapInternalSettingsEndpoints();

        return app;
    }
}
