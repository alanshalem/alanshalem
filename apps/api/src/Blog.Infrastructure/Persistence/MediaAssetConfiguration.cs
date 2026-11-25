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

        // Único: es lo que hace que la misma imagen subida dos veces sea un solo asset.
        builder.Property(asset => asset.Hash).IsRequired().HasMaxLength(MediaAsset.HashLength);
        builder.HasIndex(asset => asset.Hash).IsUnique();

        builder.Property(asset => asset.Color).IsRequired().HasMaxLength(MediaAsset.ColorLength);
        builder.Property(asset => asset.Placeholder).IsRequired().HasMaxLength(MediaAsset.MaxPlaceholderLength);
        builder.Property(asset => asset.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);

        // Se derivan del ancho (MediaVariant): no se guardan, así nunca pueden contradecir a los archivos.
        builder.Ignore(asset => asset.Variants);
        builder.Ignore(asset => asset.Url);
    }
}
