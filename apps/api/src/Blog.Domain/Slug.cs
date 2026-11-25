using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>El slug es la parte de la URL del post: "mi-primer-post". Solo minúsculas ASCII, números y guiones.</summary>
public static partial class Slug
{
    public const int MaxLength = 120;

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex ValidPattern();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();

    public static bool IsValid(string? value) =>
        !string.IsNullOrEmpty(value) && value.Length <= MaxLength && ValidPattern().IsMatch(value);

    /// <summary>"¡Hola, Mundo! Año 2026" -> "hola-mundo-ano-2026". Mismo criterio que slugify() del frontend.</summary>
    public static string From(string text)
    {
        var decomposed = text.Normalize(NormalizationForm.FormD);
        var withoutAccents = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                withoutAccents.Append(character);
            }
        }

        var slug = NonAlphanumeric().Replace(withoutAccents.ToString().ToLowerInvariant(), "-").Trim('-');
        if (slug.Length > MaxLength)
        {
            slug = slug[..MaxLength].TrimEnd('-');
        }

        return slug.Length == 0 ? "post" : slug;
    }
}
