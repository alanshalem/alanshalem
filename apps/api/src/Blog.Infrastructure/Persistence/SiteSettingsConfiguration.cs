using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class SiteSettingsConfiguration : IEntityTypeConfiguration<SiteSettings>
{
    public void Configure(EntityTypeBuilder<SiteSettings> builder)
    {
        builder.ToTable("site_settings");
        builder.HasKey(settings => settings.Id);

        // La clave es fija (SiteSettings.SingletonId): no es autoincremental.
        builder.Property(settings => settings.Id).ValueGeneratedNever();

        builder.Property(settings => settings.Name).IsRequired().HasMaxLength(SiteSettingsContent.MaxNameLength);
        builder.Property(settings => settings.Tagline).HasMaxLength(SiteSettingsContent.MaxTaglineLength);
        builder.Property(settings => settings.Bio).HasMaxLength(SiteSettingsContent.MaxBioLength);
        builder.Property(settings => settings.Email).HasMaxLength(SiteSettingsContent.MaxEmailLength);
        builder.Property(settings => settings.GithubUrl).HasMaxLength(WebUrl.MaxLength);
        builder.Property(settings => settings.LinkedinUrl).HasMaxLength(WebUrl.MaxLength);
        builder.Property(settings => settings.XUrl).HasMaxLength(WebUrl.MaxLength);
        builder.Property(settings => settings.NameEn).HasMaxLength(SiteSettingsContent.MaxNameLength);
        builder.Property(settings => settings.TaglineEn).HasMaxLength(SiteSettingsContent.MaxTaglineLength);
        builder.Property(settings => settings.BioEn).HasMaxLength(SiteSettingsContent.MaxBioLength);
    }
}
