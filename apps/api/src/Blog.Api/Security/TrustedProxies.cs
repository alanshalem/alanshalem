using Microsoft.AspNetCore.HttpOverrides;

namespace Blog.Api.Security;

/// <summary>
/// De quién se cree X-Forwarded-For / X-Forwarded-Proto: solo de las redes de proxies configuradas. Sin esto, el rate
/// limit del login vería siempre la IP de Caddy (y bloquearía a todos juntos); creyéndole a cualquiera, un cliente
/// que llega directo podría inventar su IP y saltearse el límite o ensuciar los logs.
/// </summary>
internal static class TrustedProxies
{
    /// <summary>Lista de redes CIDR (ForwardedHeaders__KnownNetworks__0=172.16.0.0/12, ...). Reemplaza a la de por defecto.</summary>
    public const string ConfigurationSection = "ForwardedHeaders:KnownNetworks";

    /// <summary>Las redes privadas donde Docker arma sus redes (ahí vive Caddy) y loopback (el proxy de Vite en desarrollo).</summary>
    public static readonly IReadOnlyList<string> DefaultNetworks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128"];

    /// <exception cref="FormatException">Si una red configurada no es un CIDR válido: la API no arranca.</exception>
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
