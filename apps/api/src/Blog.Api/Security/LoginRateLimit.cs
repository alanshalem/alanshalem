using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Blog.Api.Security;

/// <summary>
/// Anti fuerza bruta en el login: 10 intentos cada 15 minutos por IP (la del cliente real, ver <see cref="TrustedProxies"/>).
/// Sin cola: el intento 11 es un 429 inmediato.
/// </summary>
internal static class LoginRateLimit
{
    public const string PolicyName = "login";

    private const int PermitLimit = 10;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    public static IServiceCollection AddLoginRateLimit(this IServiceCollection services) =>
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(PolicyName, httpContext => RateLimitPartition.GetFixedWindowLimiter(
                httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = PermitLimit, Window = Window, QueueLimit = 0 }));
        });
}
