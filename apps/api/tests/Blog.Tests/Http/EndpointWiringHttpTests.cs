using System.Net;
using System.Text.RegularExpressions;
using Blog.Infrastructure.Build;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit.Abstractions;

namespace Blog.Tests.Http;

/// <summary>
/// The route composition of Program.cs: each endpoint module maps only its own, and the group applies the protection
/// (/api/admin requires the session, /api/internal the builder token). The real route table is walked, so a new route
/// left outside its group fails here even if nobody adds it to a list.
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
            // With the anti-CSRF header: this way the 401 comes from the session or the token, not the middleware's 403.
            using var response = await client.SendAsync(ApiFactory.Mutation(new HttpMethod(method), Url(pattern)));
            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {pattern} answered {(int)response.StatusCode} without credentials.");
        }
    }

    [Fact]
    public void The_builder_options_that_Program_binds_are_the_ones_every_consumer_resolves()
    {
        var builder = api.Services.GetRequiredService<IOptions<BuilderOptions>>().Value;

        Assert.Equal((string.Empty, ApiFactory.BuilderToken), (builder.Url, builder.Token));
    }

    /// <summary>Method and pattern of every API endpoint, sorted (without a trailing slash, as they are requested).</summary>
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
