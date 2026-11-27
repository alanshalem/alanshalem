using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// Only for the dotnet-ef tool (generating migrations): builds the DbContext without starting the API.
/// `migrations add` does not open the database; the connection string only picks the provider (SQLite).
/// Usage, from apps/api:
///   dotnet tool restore
///   dotnet ef migrations add NameOfTheChange --project src/Blog.Infrastructure --output-dir Persistence/Migrations
/// </summary>
internal sealed class DesignTimeBlogDbContextFactory : IDesignTimeDbContextFactory<BlogDbContext>
{
    public BlogDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<BlogDbContext>().UseSqlite("Data Source=design-time.db").Options);
}
