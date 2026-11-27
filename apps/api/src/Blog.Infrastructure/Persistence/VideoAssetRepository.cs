using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class VideoAssetRepository(BlogDbContext db) : IVideoAssetRepository
{
    private IQueryable<VideoAsset> WithPoster => db.VideoAssets.Include(video => video.Poster);

    public Task<VideoAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        WithPoster.FirstOrDefaultAsync(video => video.Id == id, cancellationToken);

    public Task<VideoAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken) =>
        WithPoster.FirstOrDefaultAsync(video => video.Hash == hash, cancellationToken);

    // The whole change tracker is cleared, not only the video: what was left half done (the poster, the sources) must
    // not be saved either. Used by the video process, which opens a scope (and a DbContext) per video.
    public Task<VideoAsset?> ReloadAsync(Guid id, CancellationToken cancellationToken)
    {
        db.ChangeTracker.Clear();
        return GetByIdAsync(id, cancellationToken);
    }

    public async Task<IReadOnlyList<VideoAsset>> ListProcessingAsync(CancellationToken cancellationToken) =>
        await db.VideoAssets.Where(video => video.Status == VideoStatus.Processing).ToListAsync(cancellationToken);

    public void Add(VideoAsset video) => db.VideoAssets.Add(video);

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqliteConventions.IsConstraintViolation(exception))
        {
            // The earlier lookup by hash is not atomic: if two equal uploads collide, the unique index decides.
            throw new ConflictException(MessageKeys.VideoUploadConflict);
        }
    }
}
