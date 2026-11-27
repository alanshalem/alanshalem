namespace Blog.Domain;

/// <summary>
/// Rules for the URLs that are stored and later end up in an href or a src of the site.
/// Allow list: only absolute http(s) URLs or own paths under /media/. Everything else (javascript:, data:,
/// protocol-relative URLs such as //other-site, Windows paths) is rejected.
/// </summary>
public static class WebUrl
{
    public const int MaxLength = 2048;

    /// <summary>Where uploaded images are published (Caddy in production, the API in Development).</summary>
    public const string MediaPrefix = "/media/";

    /// <summary>Image: what the media upload returns (/media/...) or an absolute http(s) URL.</summary>
    public static bool IsImageUrl(string value) => IsMediaPath(value) || IsHttpUrl(value);

    /// <summary>Absolute http:// or https:// URL with a host.</summary>
    public static bool IsHttpUrl(string value)
    {
        if (!HasSafeCharacters(value)
            || !(value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                 || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            && uri.Host.Length > 0;
    }

    // No '%': the names the upload generates never use it, and this way an encoded ".." (%2e%2e) cannot slip in, which
    // the browser normalizes as a dot segment and resolves outside /media/.
    private static bool IsMediaPath(string value) =>
        HasSafeCharacters(value)
        && value.StartsWith(MediaPrefix, StringComparison.Ordinal)
        && value.Length > MediaPrefix.Length
        && !value.Contains('%')
        && !value.Split('/').Contains("..");

    // No spaces, control characters, backslashes or quotes/angle brackets: nothing that could break an HTML attribute.
    private static bool HasSafeCharacters(string value) =>
        value.Length <= MaxLength
        && value.All(character => !char.IsWhiteSpace(character)
            && !char.IsControl(character)
            && character is not ('\\' or '"' or '\'' or '<' or '>' or '`'));
}

/// <summary>Common normalization of optional texts: they are trimmed and empty is stored as null.</summary>
internal static class OptionalText
{
    /// <param name="tooLongKey">The message when it is exceeded: its {max} is <paramref name="maxLength"/>.</param>
    /// <param name="arguments">Other placeholders of that message, if any.</param>
    public static string? Clean(string? value, int maxLength, string tooLongKey, params (string Name, object Value)[] arguments)
    {
        var clean = value?.Trim();
        if (string.IsNullOrEmpty(clean))
        {
            return null;
        }

        if (clean.Length > maxLength)
        {
            throw new DomainException(tooLongKey, [("max", maxLength), .. arguments]);
        }

        return clean;
    }
}
