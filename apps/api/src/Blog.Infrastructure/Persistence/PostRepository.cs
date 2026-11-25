using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class PostRepository(BlogDbContext db) : IPostRepository
{
    // Código de error de SQLite para "violación de constraint" (índice único, NOT NULL, etc.).
    private const int SqliteConstraintError = 19;

    public Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        db.Posts.FirstOrDefaultAsync(post => post.Id == id, cancellationToken);

    public Task<bool> SlugExistsAsync(string slug, Guid? excludingId, CancellationToken cancellationToken) =>
        db.Posts.AnyAsync(post => post.Slug == slug && post.Id != excludingId, cancellationToken);

    public async Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .OrderByDescending(post => post.UpdatedAtUtc)
            .Select(post => new PostSummaryDto(
                post.Id, post.Slug, post.Title, post.Status, post.UpdatedAtUtc, post.PublishedAtUtc, post.CoverUrl, post.CoverAlt))
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
        catch (DbUpdateException exception) when (exception.InnerException is SqliteException { SqliteErrorCode: SqliteConstraintError })
        {
            // El chequeo previo de slug no es atómico: si dos guardados chocan, el índice único tiene la última palabra.
            throw new ConflictException("Ya existe un post con ese slug.");
        }
    }
}
