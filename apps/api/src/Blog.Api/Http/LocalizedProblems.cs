using Blog.Domain;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Http;

/// <summary>
/// The only place that finishes every problem details of the API, whoever writes it (the exception handler, the
/// status code pages for the framework's empty 4xx, Results.Problem): title in the language of the request
/// (<see cref="RequestLanguage"/>), a stable "code" so the client decides without reading the text, and
/// Vary: Accept-Language.
/// </summary>
internal static class LocalizedProblems
{
    /// <summary>The problem details extension with the message key.</summary>
    public const string CodeExtension = "code";

    // One title per status; the rest falls back to the generic one of its family (4xx: invalid data; 5xx: internal error).
    private static readonly Dictionary<int, string> TitleKeys = new()
    {
        [StatusCodes.Status400BadRequest] = MessageKeys.ProblemBadRequest,
        [StatusCodes.Status401Unauthorized] = MessageKeys.ProblemUnauthorized,
        [StatusCodes.Status403Forbidden] = MessageKeys.ProblemForbidden,
        [StatusCodes.Status404NotFound] = MessageKeys.ProblemNotFound,
        [StatusCodes.Status405MethodNotAllowed] = MessageKeys.ProblemMethodNotAllowed,
        [StatusCodes.Status409Conflict] = MessageKeys.ProblemConflict,
        [StatusCodes.Status413PayloadTooLarge] = MessageKeys.ProblemPayloadTooLarge,
        [StatusCodes.Status415UnsupportedMediaType] = MessageKeys.ProblemUnsupportedMediaType,
        [StatusCodes.Status429TooManyRequests] = MessageKeys.ProblemTooManyRequests,
        [StatusCodes.Status500InternalServerError] = MessageKeys.ProblemInternalError,
        [StatusCodes.Status503ServiceUnavailable] = MessageKeys.ProblemUnavailable,
    };

    /// <summary>
    /// For <c>ProblemDetailsOptions.CustomizeProblemDetails</c>. If whoever wrote the problem already set a "code" (the
    /// key of the detail of one of our exceptions) it is respected; otherwise, the code is the key of the title.
    /// </summary>
    public static void Localize(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        var titleKey = TitleKeyOf(problem.Status ?? context.HttpContext.Response.StatusCode);

        problem.Title = MessageCatalog.Format(new UserMessage(titleKey), RequestLanguage.Of(context.HttpContext.Request));
        problem.Extensions.TryAdd(CodeExtension, titleKey);

        // The same URL answers differently depending on the requested language: no cache may mix the two versions.
        context.HttpContext.Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptLanguage);
    }

    private static string TitleKeyOf(int status) =>
        TitleKeys.TryGetValue(status, out var titleKey) ? titleKey
        : status >= StatusCodes.Status500InternalServerError ? MessageKeys.ProblemInternalError
        : MessageKeys.ProblemBadRequest;
}
