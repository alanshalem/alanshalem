using Blog.Infrastructure.Build;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class SiteBuildStateConfiguration : IEntityTypeConfiguration<SiteBuildState>
{
    public void Configure(EntityTypeBuilder<SiteBuildState> builder)
    {
        builder.ToTable("site_build_state");
        builder.HasKey(state => state.Id);

        // Fixed key (SiteBuildState.SingletonId), and the row exists since the migration: marking and clearing are an UPDATE.
        builder.Property(state => state.Id).ValueGeneratedNever();
        builder.HasData(new SiteBuildState { Id = SiteBuildState.SingletonId });
    }
}
