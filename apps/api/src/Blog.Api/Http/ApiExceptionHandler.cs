using Blog.Application;
using Blog.Domain;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Http;

/// <summary>
/// Traduce las excepciones conocidas a respuestas HTTP (ProblemDetails) en el idioma del pedido (<see cref="RequestLanguage"/>).
/// Además de title y detail suma "code": la clave del mensaje, estable, para que el cliente decida sin leer el texto.
/// Lo inesperado es 500 sin filtrar detalles.
/// </summary>
internal sealed class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger)
    : IExceptionHandler
{
    // La extensión del problem details con la clave del mensaje.
    private const string CodeExtension = "code";

    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, titleKey) = exception switch
        {
            DomainException => (StatusCodes.Status400BadRequest, MessageKeys.ProblemBadRequest),
            NotFoundException => (StatusCodes.Status404NotFound, MessageKeys.ProblemNotFound),
            ConflictException => (StatusCodes.Status409Conflict, MessageKeys.ProblemConflict),
            _ => (StatusCodes.Status500InternalServerError, MessageKeys.ProblemInternalError),
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Error no controlado en {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }

        // El mensaje de las excepciones propias es seguro de mostrar; el de una inesperada, no (queda solo el título).
        var detail = status == StatusCodes.Status500InternalServerError ? null : (exception as UserMessageException)?.UserMessage;
        var language = RequestLanguage.Of(httpContext.Request);

        httpContext.Response.StatusCode = status;
        // La misma URL responde distinto según el idioma pedido: que ningún caché mezcle las dos versiones.
        httpContext.Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptLanguage);
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = MessageCatalog.Format(new UserMessage(titleKey), language),
                Detail = detail is null ? null : MessageCatalog.Format(detail, language),
                Extensions = { [CodeExtension] = detail?.Key ?? titleKey },
            },
        });
    }
}
