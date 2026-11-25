using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>Casos de uso de posts. Cada cambio que afecta lo que ve el público dispara una regeneración del sitio.</summary>
public sealed class PostService(IPostRepository posts, IClock clock, ISiteBuildTrigger siteBuild)
{
    private const string DefaultLanguage = "es";

    public Task<IReadOnlyList<PostSummaryDto>> ListAsync(CancellationToken cancellationToken) =>
        posts.ListSummariesAsync(cancellationToken);

    public async Task<PostDto> GetAsync(Guid id, CancellationToken cancellationToken) =>
        (await FindAsync(id, cancellationToken)).ToDto();

    public async Task<PostDto> CreateAsync(SavePostRequest request, CancellationToken cancellationToken)
    {
        var content = ToContent(request);
        await EnsureSlugIsFreeAsync(content.Slug, excludingId: null, cancellationToken);

        var post = Post.CreateDraft(content, DefaultLanguage, clock.UtcNow);
        posts.Add(post);
        await posts.SaveChangesAsync(cancellationToken);

        // Un borrador nuevo no es visible para el público: no hace falta regenerar.
        return post.ToDto();
    }

    public async Task<PostDto> UpdateAsync(Guid id, SavePostRequest request, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var content = ToContent(request);
        await EnsureSlugIsFreeAsync(content.Slug, excludingId: id, cancellationToken);

        post.Update(content, clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);

        if (post.Status == PostStatus.Published)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return post.ToDto();
    }

    public async Task<PostDto> PublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Publish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        await siteBuild.RequestBuildAsync(cancellationToken);
        return post.ToDto();
    }

    public async Task<PostDto> UnpublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        post.Unpublish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return post.ToDto();
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        posts.Remove(post);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }
    }

    /// <summary>Lo que consume el builder de Astro: todos los posts publicados, con cuerpo.</summary>
    public async Task<IReadOnlyList<PostDto>> ListPublishedAsync(CancellationToken cancellationToken) =>
        (await posts.ListPublishedAsync(cancellationToken)).Select(post => post.ToDto()).ToList();

    private async Task<Post> FindAsync(Guid id, CancellationToken cancellationToken) =>
        await posts.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("El post no existe.");

    private static PostContent ToContent(SavePostRequest request) =>
        PostContent.Create(request.Title, request.Slug, request.Summary, request.Body, request.Tags);

    private async Task EnsureSlugIsFreeAsync(string slug, Guid? excludingId, CancellationToken cancellationToken)
    {
        if (await posts.SlugExistsAsync(slug, excludingId, cancellationToken))
        {
            throw new ConflictException($"Ya existe un post con el slug \"{slug}\".");
        }
    }
}
