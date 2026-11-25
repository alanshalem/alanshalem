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
            .Select(post => new PostTranslationDto(post.Id, post.Lang, post.Slug, post.Status, post.UpdatedAtUtc, post.ContentUpdatedAtUtc))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .OrderByDescending(post => post.UpdatedAtUtc)
            .Select(post => new PostSummaryDto(
                post.Id, post.Slug, post.Title, post.Lang, post.TranslationGroupId, post.Status, post.UpdatedAtUtc, post.ContentUpdatedAtUtc,
                post.PublishedAtUtc, post.ScheduledAtUtc, post.CoverUrl, post.CoverAlt, new List<PostTranslationDto>()))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .Where(post => post.Status == PostStatus.Published)
            .OrderByDescending(post => post.PublishedAtUtc)
            .ToListAsync(cancellationToken);

    public void Add(Post post) => db.Posts.Add(post);

    public void Remove(Post post) => db.Posts.Remove(post);

    public async Task<IReadOnlyList<Guid>> ListDueAsync(DateTime nowUtc, CancellationToken cancellationToken) =>
        await db.Posts
            .AsNoTracking()
            .Where(post => post.Status == PostStatus.Draft && post.ScheduledAtUtc != null && post.ScheduledAtUtc <= nowUtc)
            .OrderBy(post => post.ScheduledAtUtc)
            .Select(post => post.Id)
            .ToListAsync(cancellationToken);

    public async Task<int> LatestRevisionNumberAsync(Guid postId, CancellationToken cancellationToken) =>
        await db.PostRevisions
            .Where(revision => revision.PostId == postId)
            .MaxAsync(revision => (int?)revision.Number, cancellationToken) ?? 0;

    public void AddRevision(PostRevision revision) => db.PostRevisions.Add(revision);

    public async Task RemoveRevisionsBeforeAsync(Guid postId, int number, CancellationToken cancellationToken)
    {
        // Se cargan para borrarlas en el SaveChanges del guardado (y no con ExecuteDelete, que no espera a la
        // transacción). Al podar en cada guardado, casi siempre es una sola.
        var old = await db.PostRevisions
            .Where(revision => revision.PostId == postId && revision.Number < number)
            .ToListAsync(cancellationToken);
        db.PostRevisions.RemoveRange(old);
    }

    public async Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid postId, CancellationToken cancellationToken) =>
        await db.PostRevisions
            .AsNoTracking()
            .Where(revision => revision.PostId == postId)
            .OrderByDescending(revision => revision.Number)
            .Select(revision => new PostRevisionSummaryDto(
                revision.Id, revision.Number, revision.CreatedAtUtc, revision.Title, revision.Body.Length))
            .ToListAsync(cancellationToken);

    public Task<PostRevision?> GetRevisionAsync(Guid postId, Guid revisionId, CancellationToken cancellationToken) =>
        db.PostRevisions
            .AsNoTracking()
            .FirstOrDefaultAsync(revision => revision.PostId == postId && revision.Id == revisionId, cancellationToken);

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
