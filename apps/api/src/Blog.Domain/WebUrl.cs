namespace Blog.Domain;

/// <summary>
/// Reglas para las URLs que se guardan y después terminan en un href o un src del sitio.
/// Lista blanca: solo http(s) absolutas o rutas propias bajo /media/. Todo lo demás (javascript:, data:,
/// URLs relativas al protocolo como //otro-sitio, rutas de Windows) se rechaza.
/// </summary>
public static class WebUrl
{
    public const int MaxLength = 2048;

    private const string MediaPrefix = "/media/";

    /// <summary>Imagen: lo que devuelve la subida de media (/media/...) o una URL absoluta http(s).</summary>
    public static bool IsImageUrl(string value) => IsMediaPath(value) || IsHttpUrl(value);

    /// <summary>URL absoluta http:// o https:// con host.</summary>
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

    // Sin '%': los nombres que genera la subida nunca lo usan, y así no se cuela un ".." codificado (%2e%2e)
    // que el navegador normaliza como segmento de punto y resuelve fuera de /media/.
    private static bool IsMediaPath(string value) =>
        HasSafeCharacters(value)
        && value.StartsWith(MediaPrefix, StringComparison.Ordinal)
        && value.Length > MediaPrefix.Length
        && !value.Contains('%')
        && !value.Split('/').Contains("..");

    // Sin espacios, caracteres de control, barras invertidas ni comillas/ángulos: nada que pueda cortar un atributo HTML.
    private static bool HasSafeCharacters(string value) =>
        value.Length <= MaxLength
        && value.All(character => !char.IsWhiteSpace(character)
            && !char.IsControl(character)
            && character is not ('\\' or '"' or '\'' or '<' or '>' or '`'));
}

/// <summary>Normalización común de los textos opcionales: se recortan y el vacío se guarda como null.</summary>
internal static class OptionalText
{
    public static string? Clean(string? value, int maxLength, string tooLongMessage)
    {
        var clean = value?.Trim();
        if (string.IsNullOrEmpty(clean))
        {
            return null;
        }

        if (clean.Length > maxLength)
        {
            throw new DomainException(tooLongMessage);
        }

        return clean;
    }
}
