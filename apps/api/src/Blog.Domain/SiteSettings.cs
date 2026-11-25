using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>
/// Datos del autor y del sitio que se editan desde el admin (nombre, bio, enlaces, foto del hero).
/// Hay una sola fila: siempre con <see cref="SingletonId"/>.
/// </summary>
public sealed class SiteSettings
{
    public const int SingletonId = 1;

    // Constructor para EF Core.
    private SiteSettings()
    {
        Name = string.Empty;
    }

    public int Id { get; private set; }
    public string Name { get; private set; }
    public string? Tagline { get; private set; }

    /// <summary>Markdown corto; el sitio lo renderiza con @blog/markdown.</summary>
    public string? Bio { get; private set; }

    public string? Email { get; private set; }
    public string? GithubUrl { get; private set; }
    public string? LinkedinUrl { get; private set; }
    public string? XUrl { get; private set; }
    public string? HeroImageUrl { get; private set; }
    public string? HeroImageAlt { get; private set; }
    public string? HeroImageCredit { get; private set; }

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
        HeroImageUrl = content.HeroImageUrl;
        HeroImageAlt = content.HeroImageAlt;
        HeroImageCredit = content.HeroImageCredit;
    }
}

/// <summary>Los ajustes ya validados y normalizados. Si existe una instancia, es válida.</summary>
public sealed partial record SiteSettingsContent(
    string Name,
    string? Tagline,
    string? Bio,
    string? Email,
    string? GithubUrl,
    string? LinkedinUrl,
    string? XUrl,
    string? HeroImageUrl,
    string? HeroImageAlt,
    string? HeroImageCredit)
{
    public const int MaxNameLength = 100;
    public const int MaxTaglineLength = 200;
    public const int MaxBioLength = 2000;
    public const int MaxEmailLength = 254;
    public const int MaxImageAltLength = 300;
    public const int MaxImageCreditLength = 200;

    /// <summary>Lo que se usa mientras no se guardó nada desde el admin.</summary>
    public static SiteSettingsContent Default { get; } = new(
        "Mi blog", "Notas sobre software, ideas y cosas que estoy aprendiendo.", null, null, null, null, null, null, null, null);

    // Forma mínima (algo@dominio.tld, sin espacios). La validación real de un email es mandarle un correo.
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
        string? heroImageUrl,
        string? heroImageAlt,
        string? heroImageCredit)
    {
        var cleanName = (name ?? string.Empty).Trim();
        if (cleanName.Length == 0)
        {
            throw new DomainException("El nombre es obligatorio.");
        }

        if (cleanName.Length > MaxNameLength)
        {
            throw new DomainException($"El nombre no puede superar {MaxNameLength} caracteres.");
        }

        var cleanEmail = OptionalText.Clean(email, MaxEmailLength, $"El email no puede superar {MaxEmailLength} caracteres.");
        if (cleanEmail is not null && (!EmailPattern().IsMatch(cleanEmail) || cleanEmail.Any(char.IsControl)))
        {
            throw new DomainException("El email no tiene un formato válido.");
        }

        var cleanHeroImageUrl = OptionalText.Clean(
            heroImageUrl, WebUrl.MaxLength, $"La URL de la imagen del hero no puede superar {WebUrl.MaxLength} caracteres.");
        if (cleanHeroImageUrl is not null && !WebUrl.IsImageUrl(cleanHeroImageUrl))
        {
            throw new DomainException("La imagen del hero debe ser una ruta /media/... o una URL http(s).");
        }

        return new SiteSettingsContent(
            cleanName,
            OptionalText.Clean(tagline, MaxTaglineLength, $"La frase no puede superar {MaxTaglineLength} caracteres."),
            OptionalText.Clean(bio, MaxBioLength, $"La bio no puede superar {MaxBioLength} caracteres."),
            cleanEmail,
            HttpLink(githubUrl, "GitHub"),
            HttpLink(linkedinUrl, "LinkedIn"),
            HttpLink(xUrl, "X"),
            cleanHeroImageUrl,
            OptionalText.Clean(heroImageAlt, MaxImageAltLength,
                $"El texto alternativo de la imagen del hero no puede superar {MaxImageAltLength} caracteres."),
            OptionalText.Clean(heroImageCredit, MaxImageCreditLength,
                $"El crédito de la imagen del hero no puede superar {MaxImageCreditLength} caracteres."));
    }

    private static string? HttpLink(string? value, string label)
    {
        var clean = OptionalText.Clean(value, WebUrl.MaxLength, $"El enlace de {label} no puede superar {WebUrl.MaxLength} caracteres.");
        if (clean is not null && !WebUrl.IsHttpUrl(clean))
        {
            throw new DomainException($"El enlace de {label} debe ser una URL http(s).");
        }

        return clean;
    }
}
