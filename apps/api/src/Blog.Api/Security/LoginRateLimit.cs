using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Blog.Api.Security;

/// <summary>
/// Brute-force protection on the login: 10 attempts every 15 minutes per IP (the real client's, see <see cref="TrustedProxies"/>).
/// No queue: attempt 11 is an immediate 429.
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
