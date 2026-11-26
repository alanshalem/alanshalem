using System.Net.Http.Headers;
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

/// <summary>El envío de un pedido de regeneración al builder. No guarda nada: de no perderlo se ocupa <see cref="DurableSiteBuildTrigger"/>.</summary>
internal interface IBuildRequestSender
{
    /// <summary>Nunca lanza: un builder caído, lento o que responde con error es false.</summary>
    /// <returns>Si el builder aceptó el pedido.</returns>
    Task<bool> SendAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Le pide al builder que regenere el sitio. El builder responde 202 enseguida y construye en segundo plano,
/// y junta varios pedidos seguidos en una sola construcción. Si no responde o responde con error, se registra un
/// warning y se informa que no lo aceptó: el pedido queda pendiente y se reintenta.
/// </summary>
internal sealed class HttpBuildRequestSender(
    HttpClient http,
    IOptions<BuilderOptions> options,
    ILogger<HttpBuildRequestSender> logger) : IBuildRequestSender
{
    /// <summary>Corto: guardar un post no debe quedarse esperando a un builder que no responde (se reintenta después).</summary>
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);

    public async Task<bool> SendAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.Url))
        {
            // Sin builder (desarrollo) no hay nadie que pueda aceptarlo nunca: se da por hecho para no reintentar en vano.
            logger.LogWarning("Builder:Url no está configurado; el sitio no se regenera.");
            return true;
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

            return response.IsSuccessStatusCode;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            // TaskCanceledException: se pasó del timeout, o la API se está apagando.
            logger.LogWarning(exception, "No se pudo contactar al builder.");
            return false;
        }
    }
}
