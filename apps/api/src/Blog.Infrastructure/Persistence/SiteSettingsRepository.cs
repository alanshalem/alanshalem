using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

internal sealed class SiteSettingsRepository(BlogDbContext db) : ISiteSettingsRepository
{
    // Código de error de SQLite para "violación de constraint" (acá: dos primeros guardados con la misma clave).
    private const int SqliteConstraintError = 19;

    public Task<SiteSettings?> GetAsync(CancellationToken cancellationToken) =>
        db.SiteSettings.FirstOrDefaultAsync(settings => settings.Id == SiteSettings.SingletonId, cancellationToken);

    public void Add(SiteSettings settings) => db.SiteSettings.Add(settings);

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqliteException { SqliteErrorCode: SqliteConstraintError })
        {
            throw new ConflictException("Los ajustes se guardaron al mismo tiempo desde otro lado. Recargá y volvé a intentar.");
        }
    }
}
