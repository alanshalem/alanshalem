namespace Blog.Api.Cli;

/// <summary>
/// El healthcheck del contenedor: la imagen de .NET no trae curl, así que la misma API se pregunta a sí misma.
/// </summary>
internal static class HealthCheckCommand
{
    /// <summary>El puerto es el de ASPNETCORE_URLS en el Dockerfile; el healthcheck corre dentro del contenedor.</summary>
    public static readonly Uri ReadyUrl = new("http://localhost:8080/api/health/ready");

    /// <summary>Corto: una API que tarda más que esto en contestar algo tan simple no está sana.</summary>
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);

    /// <returns>0 si ready responde 2xx; 1 si responde otra cosa, no responde o no se puede conectar.</returns>
    public static async Task<int> RunAsync(Uri url, HttpMessageHandler handler, TimeSpan timeout, TextWriter error)
    {
        using var client = new HttpClient(handler) { Timeout = timeout };
        try
        {
            using var response = await client.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                return 0;
            }

            error.WriteLine($"{url} respondió {(int)response.StatusCode}.");
        }
        catch (HttpRequestException exception)
        {
            error.WriteLine($"No se pudo conectar con {url}: {exception.Message}");
        }
        catch (TaskCanceledException)
        {
            error.WriteLine($"{url} no respondió en {timeout.TotalSeconds} s.");
        }

        return 1;
    }
}
