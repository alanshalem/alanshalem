using System.Globalization;
using System.Security.Claims;
using Blog.Application.Abstractions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Blog.Api.Security;

/// <summary>
/// La sesión del único usuario (el admin): una cookie cifrada que lleva la época de sesiones vigente al iniciarla
/// (<see cref="IAdminSessionEpoch"/>). Cada pedido la compara con la actual: después de revocar (cerrar sesión), ninguna
/// cookie emitida antes entra, aunque se haya copiado; tampoco una sin época (las de antes de este cambio).
/// </summary>
internal static class AdminSession
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;

    /// <summary>El prefijo __Host- obliga a Secure + Path=/ y prohíbe Domain.</summary>
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
                options.Cookie.HttpOnly = true; // JavaScript no puede leerla (mitiga robo por XSS)
                options.Cookie.SameSite = SameSiteMode.Strict; // no viaja en peticiones iniciadas desde otros sitios
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.ExpireTimeSpan = Lifetime;
                options.SlidingExpiration = false;

                // Es una API: sin sesión se responde 401/403 (con su problem details), no se redirige a una página de login.
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

    /// <summary>Inicia la sesión con la época vigente.</summary>
    public static async Task SignInAsync(HttpContext http, IAdminSessionEpoch epoch)
    {
        var current = await epoch.CurrentAsync(http.RequestAborted);
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, "admin"), new Claim(EpochClaim, current.ToString(CultureInfo.InvariantCulture))], Scheme);
        await http.SignInAsync(Scheme, new ClaimsPrincipal(identity));
    }

    // Barato: la época actual está en memoria (IAdminSessionEpoch); la base se lee una sola vez por proceso.
    private static async Task RejectRevokedAsync(CookieValidatePrincipalContext context)
    {
        var epoch = context.HttpContext.RequestServices.GetRequiredService<IAdminSessionEpoch>();
        var current = await epoch.CurrentAsync(context.HttpContext.RequestAborted);
        if (context.Principal?.FindFirst(EpochClaim)?.Value != current.ToString(CultureInfo.InvariantCulture))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme); // borra la cookie inválida del navegador
        }
    }
}
