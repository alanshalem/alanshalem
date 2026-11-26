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

    /// <summary>Una sola fila: la regeneración pendiente (<see cref="DurableSiteBuildTrigger"/>). Interna, como su tipo.</summary>
    internal DbSet<SiteBuildState> SiteBuildStates => Set<SiteBuildState>();

    /// <summary>Una sola fila: la época de las sesiones del admin (<see cref="AdminSessionEpoch"/>). Interna, como su tipo.</summary>
    internal DbSet<AdminSessionState> AdminSessionStates => Set<AdminSessionState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(BlogDbContext).Assembly);
}
