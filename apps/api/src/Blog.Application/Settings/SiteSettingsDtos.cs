using Blog.Domain;

namespace Blog.Application.Settings;

/// <summary>Entrada del PUT de ajustes. Todo opcional salvo el nombre; vacío = null. Los En son la versión en inglés.</summary>
public sealed record SaveSiteSettingsRequest(
    string? Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? NameEn = null,
    string? TaglineEn = null,
    string? BioEn = null);

/// <param name="NameEn">Null = el sitio en inglés usa el de español (igual TaglineEn y BioEn).</param>
public sealed record SiteSettingsDto(
    string Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? NameEn,
    string? TaglineEn,
    string? BioEn);

public static class SiteSettingsMapping
{
    public static SiteSettingsDto ToDto(this SiteSettings settings) => new(
        settings.Name,
        settings.Tagline,
        settings.Bio,
        settings.Email,
        settings.GithubUrl,
        settings.LinkedinUrl,
        settings.XUrl,
        settings.NameEn,
        settings.TaglineEn,
        settings.BioEn);

    public static SiteSettingsDto ToDto(this SiteSettingsContent content) => new(
        content.Name,
        content.Tagline,
        content.Bio,
        content.Email,
        content.GithubUrl,
        content.LinkedinUrl,
        content.XUrl,
        content.NameEn,
        content.TaglineEn,
        content.BioEn);
}
