namespace Blog.Api.Cli;

/// <summary>
/// The container healthcheck: the .NET image has no curl, so the API asks itself.
/// </summary>
internal static class HealthCheckCommand
{
    /// <summary>The port is the one of ASPNETCORE_URLS in the Dockerfile; the healthcheck runs inside the container.</summary>
    public static readonly Uri ReadyUrl = new("http://localhost:8080/api/health/ready");

    /// <summary>Short: an API that takes longer than this to answer something so simple is not healthy.</summary>
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);

    /// <returns>0 if ready answers 2xx; 1 if it answers something else, does not answer or cannot be reached.</returns>
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

            error.WriteLine($"{url} answered {(int)response.StatusCode}.");
        }
        catch (HttpRequestException exception)
        {
            error.WriteLine($"Could not connect to {url}: {exception.Message}");
        }
        catch (TaskCanceledException)
        {
            error.WriteLine($"{url} did not answer within {timeout.TotalSeconds} s.");
        }

        return 1;
    }
}
