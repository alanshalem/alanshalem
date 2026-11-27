using System.Text.RegularExpressions;
using Blog.Domain;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Http;

/// <summary>
/// Which language to write to whoever made the request in: English if the first Accept-Language preference is English
/// (en, en-US...); otherwise, or without the header, Spanish. It is the same rule as Caddy's root redirect, so the site
/// and the admin agree. Quality (q) is not negotiated: with two languages, the first preference is enough.
/// </summary>
internal static partial class RequestLanguage
{
    // The same as Caddy's matcher: (?i)^\s*en\b
    [GeneratedRegex(@"^\s*en\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstPreferenceIsEnglish();

    /// <returns>One of <see cref="Language"/>.</returns>
    public static string Of(HttpRequest request) =>
        FirstPreferenceIsEnglish().IsMatch(request.Headers[HeaderNames.AcceptLanguage].ToString())
            ? Language.English
            : Language.Default;

    /// <summary>The same rule for the request being served; outside a request (no HTTP context), the default language.</summary>
    /// <returns>One of <see cref="Language"/>.</returns>
    public static string Of(IHttpContextAccessor http) =>
        http.HttpContext is { } context ? Of(context.Request) : Language.Default;
}
