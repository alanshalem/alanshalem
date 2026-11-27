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
            // Here the only possible constraint is the fixed key: two first saves at the same time.
            throw new ConflictException(MessageKeys.SettingsSaveConflict);
        }
    }
}
