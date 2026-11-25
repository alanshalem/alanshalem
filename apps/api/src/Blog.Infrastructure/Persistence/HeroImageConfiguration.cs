using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class HeroImageConfiguration : IEntityTypeConfiguration<HeroImage>
{
    public void Configure(EntityTypeBuilder<HeroImage> builder)
    {
        builder.ToTable("hero_images");
        builder.HasKey(image => image.Id);

        // Restrict: un asset en uso por el hero no se puede borrar por accidente (y borrar la foto no toca el asset).
        builder.HasOne(image => image.Media)
            .WithMany()
            .HasForeignKey(image => image.MediaAssetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(image => image.Alt).IsRequired().HasMaxLength(HeroImageContent.MaxAltLength);
        builder.Property(image => image.Credit).HasMaxLength(HeroImageContent.MaxCreditLength);
        builder.Property(image => image.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);
    }
}
