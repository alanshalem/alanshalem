using Blog.Domain;

namespace Blog.Application.Settings;

/// <summary>Input of the settings PUT. Everything optional except the name; empty = null. The En ones are the English version.</summary>
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

/// <param name="TaglineEn">Null = the English site uses the Spanish one (same for BioEn). The name is one single field.</param>
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
