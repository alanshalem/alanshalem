using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class SiteSettingsRepository(BlogDbContext db) : ISiteSettingsRepository
{
    public Task<SiteSettings?> GetAsync(CancellationToken cancellationToken) =>
        db.SiteSettings.FirstOrDefaultAsync(settings => settings.Id == SiteSettings.SingletonId, cancellationToken);

    public void Add(SiteSettings settings) => db.SiteSettings.Add(settings);

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqliteConventions.IsConstraintViolation(exception))
        {
            // Acá la única constraint posible es la clave fija: dos primeros guardados al mismo tiempo.
            throw new ConflictException("Los ajustes se guardaron al mismo tiempo desde otro lado. Recargá y volvé a intentar.");
        }
    }
}
