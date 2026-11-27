using Blog.Domain;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Security;
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

    /// <summary>A single row: the pending regeneration (<see cref="DurableSiteBuildTrigger"/>). Internal, like its type.</summary>
    internal DbSet<SiteBuildState> SiteBuildStates => Set<SiteBuildState>();

    /// <summary>A single row: the admin session epoch (<see cref="AdminSessionEpoch"/>). Internal, like its type.</summary>
    internal DbSet<AdminSessionState> AdminSessionStates => Set<AdminSessionState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(BlogDbContext).Assembly);
}
