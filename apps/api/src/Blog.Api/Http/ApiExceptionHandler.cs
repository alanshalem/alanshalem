using Blog.Application;
using Blog.Domain;
using Microsoft.AspNetCore.Diagnostics;

namespace Blog.Api.Http;

/// <summary>Traduce las excepciones conocidas a respuestas HTTP (ProblemDetails). Lo inesperado es 500 sin filtrar detalles.</summary>
internal sealed class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, title) = exception switch
        {
            DomainException => (StatusCodes.Status400BadRequest, "Datos inválidos"),
            NotFoundException => (StatusCodes.Status404NotFound, "No encontrado"),
            ConflictException => (StatusCodes.Status409Conflict, "Conflicto"),
            _ => (StatusCodes.Status500InternalServerError, "Error interno"),
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Error no controlado en {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = title,
                // El mensaje de las excepciones propias es seguro de mostrar; el de una inesperada, no.
                Detail = status == StatusCodes.Status500InternalServerError ? null : exception.Message,
            },
        });
    }
}
