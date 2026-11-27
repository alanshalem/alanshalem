using System.Net;
using System.Text.RegularExpressions;
using Blog.Infrastructure.Build;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit.Abstractions;

namespace Blog.Tests.Http;

/// <summary>
/// La composición de rutas de Program.cs: cada módulo de endpoints mapea solo lo suyo, y la protección la pone el grupo
/// (/api/admin exige la sesión, /api/internal el token del builder). Se recorre la tabla de rutas real, así una ruta
/// nueva que quede fuera de su grupo falla acá aunque nadie la agregue a una lista.
/// </summary>
[Collection(ApiCollection.Name)]
public partial class EndpointWiringHttpTests(ApiFactory api, ITestOutputHelper output)
{
    private const string AnyId = "0198f3a0-0000-7000-8000-000000000000";

    [Fact]
    public async Task Every_admin_route_needs_the_session_and_every_internal_route_the_builder_token()
    {
        var routes = Routes();
        foreach (var (method, pattern) in routes)
        {
            output.WriteLine($"{method} {pattern}");
        }

        var admin = routes.Where(route => route.Pattern.StartsWith("/api/admin/", StringComparison.Ordinal)).ToList();
        var builderOnly = routes.Where(route => route.Pattern.StartsWith("/api/internal/", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(admin);
        Assert.NotEmpty(builderOnly);

        using var client = api.CreateHttpsClient();
        foreach (var (method, pattern) in admin.Concat(builderOnly))
        {
            // Con la cabecera anti-CSRF: así el 401 es de la sesión o del token, no el 403 del middleware.
            using var response = await client.SendAsync(ApiFactory.Mutation(new HttpMethod(method), Url(pattern)));
            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {pattern} respondió {(int)response.StatusCode} sin credenciales.");
        }
    }

    [Fact]
    public void The_builder_options_that_Program_binds_are_the_ones_every_consumer_resolves()
    {
        var builder = api.Services.GetRequiredService<IOptions<BuilderOptions>>().Value;

        Assert.Equal((string.Empty, ApiFactory.BuilderToken), (builder.Url, builder.Token));
    }

    /// <summary>Método y patrón de cada endpoint de la API, ordenados (sin barra final, como se piden).</summary>
    private List<(string Method, string Pattern)> Routes() =>
        [.. api.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"])
                .Select(method => (method, "/" + endpoint.RoutePattern.RawText!.Trim('/'))))
            .Order()];

    private static string Url(string pattern) => RouteParameter().Replace(pattern, AnyId);

    [GeneratedRegex(@"\{[^}]+\}")]
    private static partial Regex RouteParameter();
}
