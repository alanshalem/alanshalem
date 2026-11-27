using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Settings;

/// <summary>Use cases of the site settings (author data and links).</summary>
public sealed class SiteSettingsService(ISiteSettingsRepository settings, ISiteBuildTrigger siteBuild)
{
    /// <summary>What is stored or, if nothing was saved yet, the default values (without creating the row).</summary>
    public async Task<SiteSettingsDto> GetAsync(CancellationToken cancellationToken) =>
        (await settings.GetAsync(cancellationToken))?.ToDto() ?? SiteSettingsContent.Default.ToDto();

    public async Task<SiteSettingsDto> SaveAsync(SaveSiteSettingsRequest request, CancellationToken cancellationToken)
    {
        // Validated before reading or touching anything: an invalid request does not change what is stored.
        var content = SiteSettingsContent.Create(
            request.Name,
            request.Tagline,
            request.Bio,
            request.Email,
            request.GithubUrl,
            request.LinkedinUrl,
            request.XUrl,
            request.TaglineEn,
            request.BioEn);

        var current = await settings.GetAsync(cancellationToken);
        if (current is null)
        {
            current = SiteSettings.Create(content);
            settings.Add(current);
        }
        else
        {
            current.Update(content);
        }

        await settings.SaveChangesAsync(cancellationToken);

        // Name, bio and links appear on every page: the site must always be regenerated.
        await siteBuild.RequestBuildAsync(cancellationToken);
        return current.ToDto();
    }
}
