using Blog.Application.Posts;

namespace Blog.Api.Endpoints;

public static class PostEndpoints
{
    /// <summary>Posts, history and scheduling inside the /api/admin group (session cookie + anti-CSRF header).</summary>
    public static RouteGroupBuilder MapAdminPostEndpoints(this RouteGroupBuilder admin)
    {
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

        // Creates the draft of the version in another language (content copied); answers with that new draft.
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

        // History: the list without bodies, a whole version, and restoring it (one more save; answers with the post).
        posts.MapGet("/{id:guid}/revisions", (Guid id, PostService service, CancellationToken ct) =>
            service.ListRevisionsAsync(id, ct));
        posts.MapGet("/{id:guid}/revisions/{revisionId:guid}", (Guid id, Guid revisionId, PostService service, CancellationToken ct) =>
            service.GetRevisionAsync(id, revisionId, ct));
        posts.MapPost("/{id:guid}/revisions/{revisionId:guid}/restore", (Guid id, Guid revisionId, PostService service, CancellationToken ct) =>
            service.RestoreRevisionAsync(id, revisionId, ct));

        // Scheduled publishing of a draft; both answer with the post.
        posts.MapPut("/{id:guid}/schedule", (Guid id, SchedulePostRequest request, PostService service, CancellationToken ct) =>
            service.ScheduleAsync(id, request, ct));
        posts.MapDelete("/{id:guid}/schedule", (Guid id, PostService service, CancellationToken ct) =>
            service.UnscheduleAsync(id, ct));

        return admin;
    }

    /// <summary>The published posts the builder reads, inside the /api/internal group (builder token).</summary>
    public static RouteGroupBuilder MapInternalPostEndpoints(this RouteGroupBuilder builderOnly)
    {
        builderOnly.MapGet("/posts", (PostService service, CancellationToken ct) => service.ListPublishedAsync(ct));

        return builderOnly;
    }
}
