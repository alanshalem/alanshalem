using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>
/// Author and site data edited from the admin (name, bio, links). The hero photos are a separate gallery
/// (<see cref="HeroImage"/>).
/// There is a single row: always with <see cref="SingletonId"/>. Unsuffixed texts are the Spanish ones; the En ones are
/// their English version and, if missing (null), the English site uses the Spanish one. The name is a proper name: one
/// single field for both languages.
/// </summary>
public sealed class SiteSettings
{
    public const int SingletonId = 1;

    // Constructor for EF Core.
    private SiteSettings()
    {
        Name = string.Empty;
    }

    public int Id { get; private set; }
    public string Name { get; private set; }
    public string? Tagline { get; private set; }

    /// <summary>Short Markdown; the site renders it with @blog/markdown.</summary>
    public string? Bio { get; private set; }

    public string? Email { get; private set; }
    public string? GithubUrl { get; private set; }
    public string? LinkedinUrl { get; private set; }
    public string? XUrl { get; private set; }
    public string? TaglineEn { get; private set; }
    public string? BioEn { get; private set; }

    public static SiteSettings Create(SiteSettingsContent content)
    {
        var settings = new SiteSettings { Id = SingletonId };
        settings.Apply(content);
        return settings;
    }

    public void Update(SiteSettingsContent content) => Apply(content);

    private void Apply(SiteSettingsContent content)
    {
        Name = content.Name;
        Tagline = content.Tagline;
        Bio = content.Bio;
        Email = content.Email;
        GithubUrl = content.GithubUrl;
        LinkedinUrl = content.LinkedinUrl;
        XUrl = content.XUrl;
        TaglineEn = content.TaglineEn;
        BioEn = content.BioEn;
    }
}

/// <summary>The settings, validated and normalized. If an instance exists, it is valid.</summary>
public sealed partial record SiteSettingsContent(
    string Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? TaglineEn = null,
    string? BioEn = null)
{
    public const int MaxNameLength = 100;
    public const int MaxTaglineLength = 200;
    public const int MaxBioLength = 2000;
    public const int MaxEmailLength = 254;

    /// <summary>What is used until something is saved from the admin.</summary>
    public static SiteSettingsContent Default { get; } = new(
        "Mi blog", "Notas sobre software, ideas y cosas que estoy aprendiendo.", null, null, null, null, null);

    // Minimal shape (something@domain.tld, no spaces). The real validation of an email is sending it a message.
    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    public static SiteSettingsContent Create(
        string? name,
        string? tagline,
        string? bio,
        string? email,
        string? githubUrl,
        string? linkedinUrl,
        string? xUrl,
        string? taglineEn = null,
        string? bioEn = null)
    {
        var cleanName = (name ?? string.Empty).Trim();
        if (cleanName.Length == 0)
        {
            throw new DomainException(MessageKeys.SettingsNameRequired);
        }

        if (cleanName.Length > MaxNameLength)
        {
            throw new DomainException(MessageKeys.SettingsNameTooLong, ("max", MaxNameLength));
        }

        var cleanEmail = OptionalText.Clean(email, MaxEmailLength, MessageKeys.SettingsEmailTooLong);
        if (cleanEmail is not null && (!EmailPattern().IsMatch(cleanEmail) || cleanEmail.Any(char.IsControl)))
        {
            throw new DomainException(MessageKeys.SettingsEmailInvalid);
        }

        return new SiteSettingsContent(
            cleanName,
            OptionalText.Clean(tagline, MaxTaglineLength, MessageKeys.SettingsTaglineTooLong),
            OptionalText.Clean(bio, MaxBioLength, MessageKeys.SettingsBioTooLong),
            cleanEmail,
            HttpLink(githubUrl, "GitHub"),
            HttpLink(linkedinUrl, "LinkedIn"),
            HttpLink(xUrl, "X"),
            // Same limits as their Spanish counterparts, but optional. The name is one single field for both languages.
            OptionalText.Clean(taglineEn, MaxTaglineLength, MessageKeys.SettingsTaglineEnTooLong),
            OptionalText.Clean(bioEn, MaxBioLength, MessageKeys.SettingsBioEnTooLong));
    }

    // The label is the name of the network (GitHub, LinkedIn, X): the same in both languages, kept as is.
    private static string? HttpLink(string? value, string label)
    {
        var clean = OptionalText.Clean(value, WebUrl.MaxLength, MessageKeys.SettingsLinkTooLong, ("label", label));
        if (clean is not null && !WebUrl.IsHttpUrl(clean))
        {
            throw new DomainException(MessageKeys.SettingsLinkInvalid, ("label", label));
        }

        return clean;
    }
}
