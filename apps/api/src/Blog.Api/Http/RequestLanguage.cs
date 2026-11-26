using System.Text.RegularExpressions;
using Blog.Domain;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Http;

/// <summary>
/// En qué idioma escribirle a quien hizo el pedido: inglés si la primera preferencia de Accept-Language es inglés
/// (en, en-US...); si no, o sin cabecera, español. Es la misma regla que la redirección de la raíz en Caddy, así el
/// sitio y el admin coinciden. No se negocia por calidad (q): con dos idiomas, la primera preferencia alcanza.
/// </summary>
internal static partial class RequestLanguage
{
    // Igual que el matcher de Caddy: (?i)^\s*en\b
    [GeneratedRegex(@"^\s*en\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstPreferenceIsEnglish();

    /// <returns>Uno de <see cref="Language"/>.</returns>
    public static string Of(HttpRequest request) =>
        FirstPreferenceIsEnglish().IsMatch(request.Headers[HeaderNames.AcceptLanguage].ToString())
            ? Language.English
            : Language.Default;
}
