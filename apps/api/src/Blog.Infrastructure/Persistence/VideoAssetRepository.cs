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

    // Se limpia todo el change tracker, no solo el video: lo que quedó a medias (el póster, las fuentes) tampoco debe
    // guardarse. Lo usa el proceso de videos, que abre un scope (y un DbContext) por video.
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
            // La búsqueda previa por hash no es atómica: si dos subidas iguales chocan, el índice único decide.
            throw new ConflictException(MessageKeys.VideoUploadConflict);
        }
    }
}
