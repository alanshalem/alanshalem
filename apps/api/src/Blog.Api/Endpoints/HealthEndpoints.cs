using Blog.Infrastructure.Persistence;

namespace Blog.Api.Endpoints;

public static class HealthEndpoints
{
    private static readonly object Healthy = new { status = "ok" };

    /// <summary>
    /// /api/health: the process is alive (it touches nothing). /api/health/ready: the database answers too; otherwise
    /// 503 (a problem details like any error). Used by the container healthcheck (the healthcheck command-line mode).
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
