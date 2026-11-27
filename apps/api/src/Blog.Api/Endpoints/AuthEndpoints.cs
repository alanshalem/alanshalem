using Blog.Api.Security;
using Blog.Application.Abstractions;
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
        LoginRequest request, HttpContext http, IOptions<AdminOptions> admin, IAdminSessionEpoch epoch, ILoggerFactory loggers)
    {
        // Same result and same cost (PBKDF2) whether the password is wrong or empty.
        if (!Pbkdf2PasswordHasher.Verify(request.Password ?? string.Empty, admin.Value.PasswordHash))
        {
            // To spot an attack in the logs: the IP (already resolved by TrustedProxies) and nothing the client sent.
            loggers.CreateLogger(typeof(AuthEndpoints)).LogWarning(
                "Failed login from {ClientIp}.", http.Connection.RemoteIpAddress?.ToString() ?? "unknown");
            return Results.Unauthorized();
        }

        await AdminSession.SignInAsync(http, epoch);
        return Results.NoContent();
    }

    /// <summary>
    /// With a valid session, besides deleting the cookie it revokes every issued one (a copied one too). Without a
    /// session it only deletes the cookie: otherwise anyone could log the admin out.
    /// </summary>
    private static async Task<IResult> LogoutAsync(HttpContext http, IAdminSessionEpoch epoch)
    {
        if (http.User.Identity?.IsAuthenticated == true)
        {
            // Without the request's token: if the client disconnects half way, the revocation completes anyway.
            await epoch.RevokeAllAsync(CancellationToken.None);
        }

        await http.SignOutAsync(AdminSession.Scheme);
        return Results.NoContent();
    }
}
