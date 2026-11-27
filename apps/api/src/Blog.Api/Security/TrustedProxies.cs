using Microsoft.AspNetCore.HttpOverrides;

namespace Blog.Api.Security;

/// <summary>
/// Whom X-Forwarded-For / X-Forwarded-Proto are believed from: only the configured proxy networks. Without this, the
/// login rate limit would always see Caddy's IP (and block everyone together); believing anyone, a client that arrives
/// directly could make up its IP and skip the limit or pollute the logs.
/// </summary>
internal static class TrustedProxies
{
    /// <summary>List of CIDR networks (ForwardedHeaders__KnownNetworks__0=172.16.0.0/12, ...). Replaces the default one.</summary>
    public const string ConfigurationSection = "ForwardedHeaders:KnownNetworks";

    /// <summary>The private ranges where Docker creates its networks (Caddy lives there) and loopback (Vite's proxy in development).</summary>
    public static readonly IReadOnlyList<string> DefaultNetworks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128"];

    /// <exception cref="FormatException">If a configured network is not a valid CIDR: the API does not start.</exception>
    public static IServiceCollection AddTrustedProxies(this IServiceCollection services, IConfiguration configuration)
    {
        var configured = configuration.GetSection(ConfigurationSection).Get<string[]>();
        var networks = (configured is { Length: > 0 } ? configured : DefaultNetworks).Select(System.Net.IPNetwork.Parse).ToList();

        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            foreach (var network in networks)
            {
                options.KnownIPNetworks.Add(network);
            }
        });
        return services;
    }
}
