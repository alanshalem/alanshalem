using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>The slug is the post's part of the URL: "my-first-post". Only lowercase ASCII, digits and hyphens.</summary>
public static partial class Slug
{
    public const int MaxLength = 120;

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex ValidPattern();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();

    public static bool IsValid(string? value) =>
        !string.IsNullOrEmpty(value) && value.Length <= MaxLength && ValidPattern().IsMatch(value);

    /// <summary>
    /// "my-post" + "en" -> "my-post-en". If it does not fit in <see cref="MaxLength"/> the base is shortened (never the
    /// suffix, which is what tells the slug apart), without leaving it a trailing hyphen.
    /// </summary>
    public static string WithSuffix(string slug, string suffix)
    {
        var room = MaxLength - suffix.Length - 1;
        var stem = slug.Length > room ? slug[..room].TrimEnd('-') : slug;
        return $"{stem}-{suffix}";
    }

    /// <summary>"¡Hola, Mundo! Año 2026" -> "hola-mundo-ano-2026". Same criteria as the front end's slugify().</summary>
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
