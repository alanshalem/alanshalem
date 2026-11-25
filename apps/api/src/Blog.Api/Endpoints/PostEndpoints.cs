using Blog.Api.Security;
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

        // Crea el borrador de la versión en otro idioma (contenido copiado); responde con ese borrador nuevo.
        posts.MapPost("/{id:guid}/translations", async (Guid id, CreateTranslationRequest request, PostService service, CancellationToken ct) =>
        {
            var translation = await service.CreateTranslationAsync(id, request, ct);
            return Results.Created($"/api/admin/posts/{translation.Id}", translation);
        });

        posts.MapDelete("/{id:guid}", async (Guid id, PostService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        admin.MapAdminMediaEndpoints();
        admin.MapAdminSettingsEndpoints();
        admin.MapAdminHeroImageEndpoints();

        // ----- Interno: lo consume el builder de Astro, con token. Caddy no lo expone hacia afuera. -----
        app.MapGet("/api/internal/posts", (PostService service, CancellationToken ct) => service.ListPublishedAsync(ct))
            .AddEndpointFilter<BuilderTokenFilter>();
        app.MapInternalSettingsEndpoints();
        app.MapInternalMediaEndpoints();
        app.MapInternalHeroImageEndpoints();

        return app;
    }
}
