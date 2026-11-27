using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class MediaAssetConfiguration : IEntityTypeConfiguration<MediaAsset>
{
    public void Configure(EntityTypeBuilder<MediaAsset> builder)
    {
        builder.ToTable("media_assets");
        builder.HasKey(asset => asset.Id);

        // Unique: it is what makes the same image uploaded twice a single asset.
        builder.Property(asset => asset.Hash).IsRequired().HasMaxLength(MediaAsset.HashLength);
        builder.HasIndex(asset => asset.Hash).IsUnique();

        builder.Property(asset => asset.Color).IsRequired().HasMaxLength(MediaAsset.ColorLength);
        builder.Property(asset => asset.Placeholder).IsRequired().HasMaxLength(MediaAsset.MaxPlaceholderLength);
        builder.Property(asset => asset.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);

        // Derived from the width (MediaVariant): not stored, so they can never contradict the files.
        builder.Ignore(asset => asset.Variants);
        builder.Ignore(asset => asset.Url);
    }
}
