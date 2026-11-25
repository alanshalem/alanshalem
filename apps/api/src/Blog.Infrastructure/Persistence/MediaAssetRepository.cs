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

    // Id es un Guid v7 (ordenable por tiempo): desempata dos subidas en el mismo instante.
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
            // La búsqueda previa por hash no es atómica: si dos subidas iguales chocan, el índice único decide.
            throw new ConflictException("Esa imagen se acaba de subir desde otro lado. Volvé a intentar.");
        }
    }
}
