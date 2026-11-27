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

        // Restrict: an asset used by the hero cannot be deleted by accident (and deleting the photo does not touch the asset).
        builder.HasOne(image => image.Media)
            .WithMany()
            .HasForeignKey(image => image.MediaAssetId)
            .OnDelete(DeleteBehavior.Restrict);

        // Optional (null = photo). Restrict for the same reason: deleting the item does not touch the video, and a video in use is not deleted.
        builder.HasOne(image => image.Video)
            .WithMany()
            .HasForeignKey(image => image.VideoAssetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Ignore(image => image.IsPublishable);

        builder.Property(image => image.Alt).IsRequired().HasMaxLength(HeroImageContent.MaxAltLength);
        builder.Property(image => image.Credit).HasMaxLength(HeroImageContent.MaxCreditLength);
        builder.Property(image => image.AltEn).HasMaxLength(HeroImageContent.MaxAltLength);
        builder.Property(image => image.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);
    }
}
