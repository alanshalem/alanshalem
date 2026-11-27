using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure.Persistence;

public static class DatabaseInitializer
{
    /// <summary>
    /// Creates the database folder if missing, applies the pending EF Core migrations and enables WAL
    /// (concurrent reads and writes without blocking each other).
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// If the database was created by v0.1 (EnsureCreated, without migration history): it is neither migrated nor
    /// deleted automatically.
    /// </exception>
    public static async Task InitializeAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BlogDbContext>();

        var dataSource = new SqliteConnectionStringBuilder(db.Database.GetConnectionString()).DataSource;
        if (!string.IsNullOrEmpty(dataSource) && dataSource != ":memory:")
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(dataSource));
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }
        }

        await EnsureNotLegacyAsync(db, dataSource, cancellationToken);

        await db.Database.MigrateAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;", cancellationToken);
    }

    /// <summary>
    /// v0.1 created the schema with EnsureCreated: there is a posts table but no __EFMigrationsHistory. Migrate() would
    /// try to create posts again and fail half way, so it stops earlier with a clear message.
    /// </summary>
    private static async Task EnsureNotLegacyAsync(BlogDbContext db, string dataSource, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var hasPosts = await TableExistsAsync(connection, "posts", cancellationToken);
            var hasHistory = await TableExistsAsync(connection, "__EFMigrationsHistory", cancellationToken);
            if (hasPosts && !hasHistory)
            {
                var path = string.IsNullOrEmpty(dataSource) ? "(unnamed)" : Path.GetFullPath(dataSource);
                throw new InvalidOperationException(
                    $"The database \"{path}\" was created by an earlier version without migrations (EnsureCreated) " +
                    "and cannot be upgraded automatically. Back it up or rename it " +
                    "(for example to blog.db.bak) and start the API again: a new database with the current schema will be created. " +
                    "Nothing was deleted or changed.");
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static async Task<bool> TableExistsAsync(DbConnection connection, string table, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name COLLATE NOCASE";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "$name";
        parameter.Value = table;
        command.Parameters.Add(parameter);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }
}
