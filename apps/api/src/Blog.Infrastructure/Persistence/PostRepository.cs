using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class PostRepository(BlogDbContext db) : IPostRepository
{
    public Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        db.Posts.FirstOrDefaultAsync(post => post.Id == id, cancellationToken);

    public Task<bool> SlugExistsAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken) =>
        db.Posts.AnyAsync(post => post.Lang == lang && post.Slug == slug && post.Id != excludingId, cancellationToken);

    public async Task<IReadOnlyList<PostTranslationDto>> ListVersionsAsync(Guid translationGroupId, CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .Where(post => post.TranslationGroupId == translationGroupId)
            .Select(post => new PostTranslationDto(post.Id, post.Lang, post.Slug, post.Status, post.UpdatedAtUtc))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .OrderByDescending(post => post.UpdatedAtUtc)
            .Select(post => new PostSummaryDto(
                post.Id, post.Slug, post.Title, post.Lang, post.TranslationGroupId, post.Status, post.UpdatedAtUtc, post.PublishedAtUtc,
                post.CoverUrl, post.CoverAlt, new List<PostTranslationDto>()))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .Where(post => post.Status == PostStatus.Published)
            .OrderByDescending(post => post.PublishedAtUtc)
            .ToListAsync(cancellationToken);

    public void Add(Post post) => db.Posts.Add(post);

    public void Remove(Post post) => db.Posts.Remove(post);

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqliteConventions.IsConstraintViolation(exception))
        {
            // Los chequeos previos (slug por idioma, una versión por idioma) no son atómicos: si dos guardados chocan,
            // los índices únicos tienen la última palabra.
            throw new ConflictException("Ya existe un post con ese slug en ese idioma, o el post ya tiene esa versión. Recargá y volvé a intentar.");
        }
    }
}
