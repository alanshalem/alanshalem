using Blog.Infrastructure.Persistence;

namespace Blog.Api.Endpoints;

public static class HealthEndpoints
{
    private static readonly object Healthy = new { status = "ok" };

    /// <summary>
    /// /api/health: el proceso está vivo (no toca nada). /api/health/ready: además la base responde; si no, 503 (un
    /// problem details como cualquier error). Lo usa el healthcheck del contenedor (modo healthcheck de la línea de comandos).
    /// </summary>
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        var health = app.MapGroup("/api/health");
        health.MapGet(string.Empty, () => Results.Ok(Healthy));
        health.MapGet("/ready", async (DatabaseReadiness database, CancellationToken ct) =>
            await database.IsReadyAsync(ct) ? Results.Ok(Healthy) : Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable));

        return app;
    }
}
