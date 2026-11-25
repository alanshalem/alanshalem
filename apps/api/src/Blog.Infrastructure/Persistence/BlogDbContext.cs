using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

public sealed class BlogDbContext(DbContextOptions<BlogDbContext> options) : DbContext(options)
{
    public DbSet<Post> Posts => Set<Post>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(BlogDbContext).Assembly);
}
