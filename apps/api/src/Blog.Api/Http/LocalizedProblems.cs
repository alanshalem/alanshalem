using Blog.Domain;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Http;

/// <summary>
/// El único lugar que termina de armar cada problem details de la API, lo escriba quien lo escriba (el manejador de
/// excepciones, las páginas de estado para los 4xx vacíos del framework, Results.Problem): título en el idioma del pedido
/// (<see cref="RequestLanguage"/>), "code" estable para que el cliente decida sin leer el texto, y Vary: Accept-Language.
/// </summary>
internal static class LocalizedProblems
{
    /// <summary>La extensión del problem details con la clave del mensaje.</summary>
    public const string CodeExtension = "code";

    // Un título por código; el resto cae en el genérico de su familia (4xx: datos inválidos; 5xx: error interno).
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
    /// Para <c>ProblemDetailsOptions.CustomizeProblemDetails</c>. Si quien escribió el problema ya puso un "code" (la
    /// clave del detalle de una excepción propia) lo respeta; si no, el code es la clave del título.
    /// </summary>
    public static void Localize(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        var titleKey = TitleKeyOf(problem.Status ?? context.HttpContext.Response.StatusCode);

        problem.Title = MessageCatalog.Format(new UserMessage(titleKey), RequestLanguage.Of(context.HttpContext.Request));
        problem.Extensions.TryAdd(CodeExtension, titleKey);

        // La misma URL responde distinto según el idioma pedido: que ningún caché mezcle las dos versiones.
        context.HttpContext.Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptLanguage);
    }

    private static string TitleKeyOf(int status) =>
        TitleKeys.TryGetValue(status, out var titleKey) ? titleKey
        : status >= StatusCodes.Status500InternalServerError ? MessageKeys.ProblemInternalError
        : MessageKeys.ProblemBadRequest;
}
