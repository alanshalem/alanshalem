using Blog.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

/// <summary>
/// The database check /api/health/ready uses, against real SQLite: it reads a schema table (an empty or unmigrated file
/// is not ready) and, since the healthcheck calls it every few seconds, it leaves no warnings in the logs when it works.
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
        // Without InitializeAsync: like a file that disappeared and SQLite created again, empty.
        await using var database = new SqliteTestDatabase();

        var ready = await database.InScopeAsync(provider => provider.GetRequiredService<DatabaseReadiness>().IsReadyAsync(default));

        Assert.False(ready);
        Assert.Contains(database.Logs.Entries, entry =>
            entry.Level == LogLevel.Warning && entry.Category == typeof(DatabaseReadiness).FullName);
    }
}
