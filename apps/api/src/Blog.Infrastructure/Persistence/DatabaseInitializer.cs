using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure.Persistence;

public static class DatabaseInitializer
{
    /// <summary>
    /// Crea la carpeta de la base si falta, aplica las migraciones de EF Core pendientes y activa WAL
    /// (lecturas y escritura concurrentes sin bloquearse).
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Si la base fue creada por la v0.1 (EnsureCreated, sin historial de migraciones): no se migra ni se borra sola.
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
    /// La v0.1 creaba el esquema con EnsureCreated: hay tabla posts pero no __EFMigrationsHistory. Migrate() intentaría
    /// crear posts de nuevo y fallaría a mitad de camino, así que se corta antes con un mensaje claro.
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
                var path = string.IsNullOrEmpty(dataSource) ? "(sin nombre)" : Path.GetFullPath(dataSource);
                throw new InvalidOperationException(
                    $"La base de datos \"{path}\" fue creada por una versión anterior sin migraciones (EnsureCreated) " +
                    "y no se puede actualizar automáticamente. Hacé una copia de respaldo o renombrala " +
                    "(por ejemplo a blog.db.bak) y volvé a arrancar la API: se va a crear una base nueva con el esquema actual. " +
                    "No se borró ni se modificó nada.");
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
