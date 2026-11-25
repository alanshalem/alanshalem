using System.Net.Http.Headers;
using Blog.Application.Abstractions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Build;

public sealed class BuilderOptions
{
    /// <summary>URL interna del servicio builder, ej: http://builder:4000</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>Secreto compartido: la API se lo manda al builder, y el builder se lo manda a la API para leer los posts.</summary>
    public string Token { get; set; } = string.Empty;
}

/// <summary>
/// Le pide al builder que regenere el sitio. El builder responde 202 enseguida y construye en segundo plano,
/// y junta varios pedidos seguidos en una sola construcción. Si no responde, solo se registra un warning:
/// el contenido ya está guardado y el próximo cambio (o un reintento manual) lo publicará.
/// </summary>
internal sealed class HttpSiteBuildTrigger(
    HttpClient http,
    IOptions<BuilderOptions> options,
    ILogger<HttpSiteBuildTrigger> logger) : ISiteBuildTrigger
{
    public async Task RequestBuildAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.Url))
        {
            logger.LogWarning("Builder:Url no está configurado; el sitio no se regenera.");
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Url.TrimEnd('/')}/build");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);

            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("El builder respondió {StatusCode} al pedir una regeneración.", (int)response.StatusCode);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(exception, "No se pudo contactar al builder.");
        }
    }
}
