using Blog.Api.Security;
using Blog.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Blog.Api.Endpoints;

public static class AuthEndpoints
{
    public sealed record LoginRequest(string? Password);

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", LoginAsync).RequireRateLimiting(LoginRateLimit.PolicyName);
        group.MapPost("/logout", (Delegate)LogoutAsync);
        group.MapGet("/me", () => Results.Ok(new { authenticated = true })).RequireAuthorization();

        return app;
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request, HttpContext http, IOptions<AdminOptions> admin, AdminSessionEpoch epoch, ILoggerFactory loggers)
    {
        // Mismo resultado y mismo costo (PBKDF2) tanto si la contraseña está mal como si es vacía.
        if (!Pbkdf2PasswordHasher.Verify(request.Password ?? string.Empty, admin.Value.PasswordHash))
        {
            // Para ver un ataque en los logs: la IP (ya resuelta por TrustedProxies) y nada de lo que mandó el cliente.
            loggers.CreateLogger(typeof(AuthEndpoints)).LogWarning(
                "Inicio de sesión fallido desde {ClientIp}.", http.Connection.RemoteIpAddress?.ToString() ?? "desconocida");
            return Results.Unauthorized();
        }

        await AdminSession.SignInAsync(http, epoch);
        return Results.NoContent();
    }

    /// <summary>
    /// Con una sesión válida, además de borrar la cookie revoca todas las emitidas (también una copiada). Sin sesión
    /// solo borra la cookie: si no, cualquiera podría cerrarle la sesión al admin.
    /// </summary>
    private static async Task<IResult> LogoutAsync(HttpContext http, AdminSessionEpoch epoch)
    {
        if (http.User.Identity?.IsAuthenticated == true)
        {
            // Sin el token del pedido: si el cliente corta a mitad de camino, la revocación igual se completa.
            await epoch.RevokeAllAsync(CancellationToken.None);
        }

        await http.SignOutAsync(AdminSession.Scheme);
        return Results.NoContent();
    }
}
