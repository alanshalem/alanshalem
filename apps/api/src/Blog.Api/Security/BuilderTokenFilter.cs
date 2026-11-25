using System.Security.Cryptography;
using System.Text;
using Blog.Infrastructure.Build;
using Microsoft.Extensions.Options;

namespace Blog.Api.Security;

/// <summary>
/// Protege los endpoints internos (los que lee el builder): exige "Authorization: Bearer {Builder:Token}".
/// Además, Caddy no los expone hacia afuera; esto es la segunda barrera.
/// </summary>
internal sealed class BuilderTokenFilter(IOptions<BuilderOptions> options) : IEndpointFilter
{
    private const string Scheme = "Bearer ";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var header = context.HttpContext.Request.Headers.Authorization.ToString();
        var provided = header.StartsWith(Scheme, StringComparison.OrdinalIgnoreCase) ? header[Scheme.Length..] : string.Empty;

        var expectedBytes = Encoding.UTF8.GetBytes(options.Value.Token);
        var providedBytes = Encoding.UTF8.GetBytes(provided);

        // Tiempo constante: no se puede ir adivinando el token por diferencias de tiempo de respuesta.
        if (expectedBytes.Length == 0 || !CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes))
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}
