using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class MediaAssetRepository(BlogDbContext db) : IMediaAssetRepository
{
    public Task<MediaAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        db.MediaAssets.FirstOrDefaultAsync(asset => asset.Id == id, cancellationToken);

    public Task<MediaAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken) =>
        db.MediaAssets.FirstOrDefaultAsync(asset => asset.Hash == hash, cancellationToken);

    // Id is a v7 Guid (time-ordered): it breaks the tie between two uploads at the same instant.
    public async Task<IReadOnlyList<MediaAsset>> ListAsync(CancellationToken cancellationToken) =>
        await db.MediaAssets
            .AsNoTracking()
            .OrderBy(asset => asset.CreatedAtUtc)
            .ThenBy(asset => asset.Id)
            .ToListAsync(cancellationToken);

    public void Add(MediaAsset asset) => db.MediaAssets.Add(asset);

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqliteConventions.IsConstraintViolation(exception))
        {
            // The earlier lookup by hash is not atomic: if two equal uploads collide, the unique index decides.
            throw new ConflictException(MessageKeys.MediaUploadConflict);
        }
    }
}
