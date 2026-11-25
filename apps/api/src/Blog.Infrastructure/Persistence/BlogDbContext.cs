using Blog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Blog.Infrastructure.Persistence;

public sealed class BlogDbContext(DbContextOptions<BlogDbContext> options) : DbContext(options)
{
    public DbSet<Post> Posts => Set<Post>();

    public DbSet<PostRevision> PostRevisions => Set<PostRevision>();

    public DbSet<SiteSettings> SiteSettings => Set<SiteSettings>();

    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();

    public DbSet<HeroImage> HeroImages => Set<HeroImage>();

    public DbSet<VideoAsset> VideoAssets => Set<VideoAsset>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(BlogDbContext).Assembly);
}
