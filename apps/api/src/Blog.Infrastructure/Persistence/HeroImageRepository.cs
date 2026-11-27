using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class HeroImageRepository(BlogDbContext db) : IHeroImageRepository
{
    private IQueryable<HeroImage> WithMedia =>
        db.HeroImages.Include(image => image.Media).Include(image => image.Video).ThenInclude(video => video!.Poster);

    public Task<HeroImage?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        WithMedia.FirstOrDefaultAsync(image => image.Id == id, cancellationToken);

    // Id is a v7 Guid (time-ordered): it breaks the tie between two additions at the same instant.
    public async Task<IReadOnlyList<HeroImage>> ListAsync(CancellationToken cancellationToken) =>
        await WithMedia
            .AsNoTracking()
            .OrderBy(image => image.CreatedAtUtc)
            .ThenBy(image => image.Id)
            .ToListAsync(cancellationToken);

    public void Add(HeroImage image) => db.HeroImages.Add(image);

    public void Remove(HeroImage image) => db.HeroImages.Remove(image);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => db.SaveChangesAsync(cancellationToken);
}
