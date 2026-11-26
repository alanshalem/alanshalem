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
    string? TaglineEn = null,
    string? BioEn = null);

/// <param name="TaglineEn">Null = el sitio en inglés usa el de español (igual BioEn). El nombre es uno solo.</param>
public sealed record SiteSettingsDto(
    string Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
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
        content.TaglineEn,
        content.BioEn);
}
