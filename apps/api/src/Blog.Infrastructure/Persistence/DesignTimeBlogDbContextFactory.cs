using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// Solo para la herramienta dotnet-ef (generar migraciones): arma el DbContext sin levantar la API.
/// `migrations add` no abre la base; la cadena de conexión solo elige el proveedor (SQLite).
/// Uso, desde apps/api:
///   dotnet tool restore
///   dotnet ef migrations add NombreDelCambio --project src/Blog.Infrastructure --output-dir Persistence/Migrations
/// </summary>
internal sealed class DesignTimeBlogDbContextFactory : IDesignTimeDbContextFactory<BlogDbContext>
{
    public BlogDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<BlogDbContext>().UseSqlite("Data Source=design-time.db").Options);
}
