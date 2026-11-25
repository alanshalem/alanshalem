using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure.Persistence;

public static class DatabaseInitializer
{
    /// <summary>
    /// Crea la carpeta y el archivo de la base si faltan y activa WAL (lecturas y escritura concurrentes sin bloquearse).
    /// v0.1 usa EnsureCreated; cuando el esquema empiece a cambiar hay que pasar a migraciones de EF Core.
    /// </summary>
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

        await db.Database.EnsureCreatedAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;", cancellationToken);
    }
}
