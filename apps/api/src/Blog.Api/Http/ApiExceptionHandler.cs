using Blog.Application;
using Blog.Domain;
using Microsoft.AspNetCore.Diagnostics;

namespace Blog.Api.Http;

/// <summary>
/// Traduce las excepciones a respuestas HTTP (ProblemDetails). Las propias traen su mensaje, que va como detail en el
/// idioma del pedido y como "code" (su clave); un pedido mal formado (JSON inválido, formulario sin archivo, cuerpo
/// demasiado grande) usa el código que trae; lo inesperado es 500 sin filtrar detalles. Título, code por defecto y Vary
/// los completa <see cref="LocalizedProblems"/>, igual que en cualquier otro problema.
/// </summary>
internal sealed class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var status = exception switch
        {
            DomainException => StatusCodes.Status400BadRequest,
            NotFoundException => StatusCodes.Status404NotFound,
            ConflictException => StatusCodes.Status409Conflict,
            // En Development el framework lanza los pedidos mal formados (en Production solo pone el código): así los
            // dos ambientes responden lo mismo.
            BadHttpRequestException badRequest => badRequest.StatusCode,
            _ => StatusCodes.Status500InternalServerError,
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Error no controlado en {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = status;
        var context = new ProblemDetailsContext { HttpContext = httpContext, Exception = exception, ProblemDetails = { Status = status } };

        // El mensaje de las excepciones propias es seguro de mostrar; el de una inesperada, no (queda solo el título).
        if (exception is UserMessageException { UserMessage: var message })
        {
            context.ProblemDetails.Detail = MessageCatalog.Format(message, RequestLanguage.Of(httpContext.Request));
            context.ProblemDetails.Extensions[LocalizedProblems.CodeExtension] = message.Key;
        }

        return await problemDetails.TryWriteAsync(context);
    }
}
