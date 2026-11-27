using System.Security.Cryptography;
using System.Text;
using Blog.Infrastructure.Build;
using Microsoft.Extensions.Options;

namespace Blog.Api.Security;

/// <summary>
/// Protects the internal endpoints (the ones the builder reads): requires "Authorization: Bearer {Builder:Token}".
/// Besides, Caddy does not expose them to the outside; this is the second barrier.
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

        // Constant time: the token cannot be guessed bit by bit from differences in response time.
        if (expectedBytes.Length == 0 || !CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes))
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}
