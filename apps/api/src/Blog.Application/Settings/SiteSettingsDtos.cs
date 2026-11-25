using Blog.Domain;

namespace Blog.Application.Settings;

/// <summary>Entrada del PUT de ajustes. Todo opcional salvo el nombre; vacío = null.</summary>
public sealed record SaveSiteSettingsRequest(
    string? Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? HeroImageUrl,
    string? HeroImageAlt,
    string? HeroImageCredit);

public sealed record SiteSettingsDto(
    string Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? HeroImageUrl,
    string? HeroImageAlt,
    string? HeroImageCredit);

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
        settings.HeroImageUrl,
        settings.HeroImageAlt,
        settings.HeroImageCredit);

    public static SiteSettingsDto ToDto(this SiteSettingsContent content) => new(
        content.Name,
        content.Tagline,
        content.Bio,
        content.Email,
        content.GithubUrl,
        content.LinkedinUrl,
        content.XUrl,
        content.HeroImageUrl,
        content.HeroImageAlt,
        content.HeroImageCredit);
}
