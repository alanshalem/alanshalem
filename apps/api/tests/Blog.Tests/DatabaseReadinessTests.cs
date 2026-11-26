using Blog.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

/// <summary>
/// La prueba de la base que usa /api/health/ready, contra SQLite real: lee una tabla del esquema (un archivo vacío o sin
/// migrar no está listo) y, como el healthcheck la llama cada pocos segundos, no deja avisos en los logs cuando anda.
/// </summary>
public class DatabaseReadinessTests
{
    [Fact]
    public async Task A_migrated_database_is_ready_without_logging_any_warning()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();

        var ready = await database.InScopeAsync(provider => provider.GetRequiredService<DatabaseReadiness>().IsReadyAsync(default));

        Assert.True(ready);
        Assert.DoesNotContain(database.Logs.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task A_database_without_the_schema_is_not_ready_and_says_so_in_the_logs()
    {
        // Sin InitializeAsync: como un archivo que desapareció y SQLite volvió a crear vacío.
        await using var database = new SqliteTestDatabase();

        var ready = await database.InScopeAsync(provider => provider.GetRequiredService<DatabaseReadiness>().IsReadyAsync(default));

        Assert.False(ready);
        Assert.Contains(database.Logs.Entries, entry =>
            entry.Level == LogLevel.Warning && entry.Category == typeof(DatabaseReadiness).FullName);
    }
}
