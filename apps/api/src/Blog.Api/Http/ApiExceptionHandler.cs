using Blog.Application;
using Blog.Domain;
using Microsoft.AspNetCore.Diagnostics;

namespace Blog.Api.Http;

/// <summary>
/// Turns exceptions into HTTP responses (ProblemDetails). Our own carry their message, which goes as detail in the
/// language of the request and as "code" (its key); a malformed request (invalid JSON, form without a file, body too
/// large) uses the status it carries; anything unexpected is a 500 without leaking details. Title, default code and
/// Vary are completed by <see cref="LocalizedProblems"/>, as for any other problem.
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
            // In Development the framework throws malformed requests (in Production it only sets the status): this way
            // both environments answer the same.
            BadHttpRequestException badRequest => badRequest.StatusCode,
            _ => StatusCodes.Status500InternalServerError,
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Unhandled error in {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = status;
        var context = new ProblemDetailsContext { HttpContext = httpContext, Exception = exception, ProblemDetails = { Status = status } };

        // The message of our own exceptions is safe to show; that of an unexpected one is not (only the title stays).
        if (exception is UserMessageException { UserMessage: var message })
        {
            context.ProblemDetails.Detail = MessageCatalog.Format(message, RequestLanguage.Of(httpContext.Request));
            context.ProblemDetails.Extensions[LocalizedProblems.CodeExtension] = message.Key;
        }

        return await problemDetails.TryWriteAsync(context);
    }
}
