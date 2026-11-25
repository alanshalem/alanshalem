using System.Security.Claims;
using Blog.Api.Security;
using Blog.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;

namespace Blog.Api.Endpoints;

public static class AuthEndpoints
{
    public sealed record LoginRequest(string? Password);

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", LoginAsync).RequireRateLimiting("login");
        group.MapPost("/logout", (Delegate)LogoutAsync);
        group.MapGet("/me", () => Results.Ok(new { authenticated = true })).RequireAuthorization();

        return app;
    }

    private static async Task<IResult> LoginAsync(LoginRequest request, HttpContext http, IOptions<AdminOptions> admin)
    {
        // Mismo resultado y mismo costo (PBKDF2) tanto si la contraseña está mal como si es vacía.
        if (!Pbkdf2PasswordHasher.Verify(request.Password ?? string.Empty, admin.Value.PasswordHash))
        {
            return Results.Unauthorized();
        }

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], CookieAuthenticationDefaults.AuthenticationScheme);
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
        return Results.NoContent();
    }

    private static async Task<IResult> LogoutAsync(HttpContext http)
    {
        await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    }
}
