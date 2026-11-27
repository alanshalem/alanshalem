using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Build;

public sealed class BuilderOptions
{
    /// <summary>Internal URL of the builder service, e.g. http://builder:4000</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>Shared secret: the API sends it to the builder, and the builder sends it to the API to read the posts.</summary>
    public string Token { get; set; } = string.Empty;
}

/// <summary>Sending a regeneration request to the builder. It stores nothing: <see cref="DurableSiteBuildTrigger"/> makes sure it is not lost.</summary>
internal interface IBuildRequestSender
{
    /// <summary>Never throws: a builder that is down, slow or answers with an error is false.</summary>
    /// <returns>Whether the builder accepted the request.</returns>
    Task<bool> SendAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Asks the builder to regenerate the site. The builder answers 202 right away and builds in the background, and it
/// merges several requests in a row into a single build. If it does not answer or answers with an error, a warning is
/// logged and it reports that it was not accepted: the request stays pending and is retried.
/// </summary>
internal sealed class HttpBuildRequestSender(
    HttpClient http,
    IOptions<BuilderOptions> options,
    ILogger<HttpBuildRequestSender> logger) : IBuildRequestSender
{
    /// <summary>Short: saving a post must not wait for a builder that does not answer (it is retried later).</summary>
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);

    public async Task<bool> SendAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.Url))
        {
            // Without a builder (development) nobody can ever accept it: it counts as done so it is not retried in vain.
            logger.LogWarning("Builder:Url is not configured; the site is not regenerated.");
            return true;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Url.TrimEnd('/')}/build");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);

            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("The builder answered {StatusCode} to a rebuild request.", (int)response.StatusCode);
            }

            return response.IsSuccessStatusCode;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            // TaskCanceledException: the timeout passed, or the API is shutting down.
            logger.LogWarning(exception, "Could not reach the builder.");
            return false;
        }
    }
}
