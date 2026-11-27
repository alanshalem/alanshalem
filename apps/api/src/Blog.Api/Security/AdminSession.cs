using System.Globalization;
using System.Security.Claims;
using Blog.Application.Abstractions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Blog.Api.Security;

/// <summary>
/// The session of the only user (the admin): an encrypted cookie carrying the session epoch current when it started
/// (<see cref="IAdminSessionEpoch"/>). Every request compares it with the current one: after revoking (logging out), no
/// cookie issued before gets in, even if it was copied; nor does one without an epoch (those from before this change).
/// </summary>
internal static class AdminSession
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;

    /// <summary>The __Host- prefix forces Secure + Path=/ and forbids Domain.</summary>
    public const string CookieName = "__Host-admin";

    private const string EpochClaim = "session_epoch";
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    public static IServiceCollection AddAdminSession(this IServiceCollection services)
    {
        services
            .AddAuthentication(Scheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = CookieName;
                options.Cookie.HttpOnly = true; // JavaScript cannot read it (mitigates theft through XSS)
                options.Cookie.SameSite = SameSiteMode.Strict; // it does not travel on requests started from other sites
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.ExpireTimeSpan = Lifetime;
                options.SlidingExpiration = false;

                // It is an API: without a session it answers 401/403 (with its problem details), it does not redirect to a login page.
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
                options.Events.OnValidatePrincipal = RejectRevokedAsync;
            });
        services.AddAuthorization();
        return services;
    }

    /// <summary>Starts the session with the current epoch.</summary>
    public static async Task SignInAsync(HttpContext http, IAdminSessionEpoch epoch)
    {
        var current = await epoch.CurrentAsync(http.RequestAborted);
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, "admin"), new Claim(EpochClaim, current.ToString(CultureInfo.InvariantCulture))], Scheme);
        await http.SignInAsync(Scheme, new ClaimsPrincipal(identity));
    }

    // Cheap: the current epoch is in memory (IAdminSessionEpoch); the database is read once per process.
    private static async Task RejectRevokedAsync(CookieValidatePrincipalContext context)
    {
        var epoch = context.HttpContext.RequestServices.GetRequiredService<IAdminSessionEpoch>();
        var current = await epoch.CurrentAsync(context.HttpContext.RequestAborted);
        if (context.Principal?.FindFirst(EpochClaim)?.Value != current.ToString(CultureInfo.InvariantCulture))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme); // deletes the invalid cookie from the browser
        }
    }
}
