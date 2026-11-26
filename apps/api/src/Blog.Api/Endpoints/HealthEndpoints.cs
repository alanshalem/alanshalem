using Blog.Api.Http;
using Blog.Domain;
using Blog.Infrastructure.Persistence;
using Microsoft.Net.Http.Headers;

namespace Blog.Api.Endpoints;

public static class HealthEndpoints
{
    private static readonly object Healthy = new { status = "ok" };

    /// <summary>
    /// /api/health: el proceso está vivo (no toca nada). /api/health/ready: además la base responde; lo usa el
    /// healthcheck del contenedor (modo healthcheck de la línea de comandos).
    /// </summary>
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        var health = app.MapGroup("/api/health");
        health.MapGet(string.Empty, () => Results.Ok(Healthy));
        health.MapGet("/ready", async (DatabaseReadiness database, HttpContext http, CancellationToken ct) =>
            await database.IsReadyAsync(ct) ? Results.Ok(Healthy) : Unavailable(http));

        return app;
    }

    private static IResult Unavailable(HttpContext http)
    {
        http.Response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptLanguage);
        return Results.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: MessageCatalog.Format(new UserMessage(MessageKeys.ProblemUnavailable), RequestLanguage.Of(http.Request)),
            extensions: new Dictionary<string, object?> { ["code"] = MessageKeys.ProblemUnavailable });
    }
}
