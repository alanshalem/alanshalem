using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>
/// Datos del autor y del sitio que se editan desde el admin (nombre, bio, enlaces). Las fotos del hero son
/// una galería aparte (<see cref="HeroImage"/>).
/// Hay una sola fila: siempre con <see cref="SingletonId"/>. Los textos sin sufijo son los de español; los En son su
/// versión en inglés y, si faltan (null), el sitio en inglés usa el de español.
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
    public string? NameEn { get; private set; }
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
        NameEn = content.NameEn;
        TaglineEn = content.TaglineEn;
        BioEn = content.BioEn;
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
    string? NameEn = null,
    string? TaglineEn = null,
    string? BioEn = null)
{
    public const int MaxNameLength = 100;
    public const int MaxTaglineLength = 200;
    public const int MaxBioLength = 2000;
    public const int MaxEmailLength = 254;

    /// <summary>Lo que se usa mientras no se guardó nada desde el admin.</summary>
    public static SiteSettingsContent Default { get; } = new(
        "Mi blog", "Notas sobre software, ideas y cosas que estoy aprendiendo.", null, null, null, null, null);

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
        string? nameEn = null,
        string? taglineEn = null,
        string? bioEn = null)
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

        return new SiteSettingsContent(
            cleanName,
            OptionalText.Clean(tagline, MaxTaglineLength, $"La frase no puede superar {MaxTaglineLength} caracteres."),
            OptionalText.Clean(bio, MaxBioLength, $"La bio no puede superar {MaxBioLength} caracteres."),
            cleanEmail,
            HttpLink(githubUrl, "GitHub"),
            HttpLink(linkedinUrl, "LinkedIn"),
            HttpLink(xUrl, "X"),
            // Mismos límites que sus pares en español, pero todos opcionales: el nombre en inglés también cae al español.
            OptionalText.Clean(nameEn, MaxNameLength, $"El nombre en inglés no puede superar {MaxNameLength} caracteres."),
            OptionalText.Clean(taglineEn, MaxTaglineLength, $"La frase en inglés no puede superar {MaxTaglineLength} caracteres."),
            OptionalText.Clean(bioEn, MaxBioLength, $"La bio en inglés no puede superar {MaxBioLength} caracteres."));
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
