using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Blog.Api.Cli;

namespace Blog.Tests.Http;

/// <summary>
/// API health: /api/health is the process being alive; /api/health/ready also checks the database (200 or 503 with
/// problem details). The healthcheck command-line mode asks ready and turns it into an exit code.
/// </summary>
[Collection(ApiCollection.Name)]
public class HealthHttpTests(ApiFactory api)
{
    private static readonly Uri ReadyUrl = new("http://localhost/api/health/ready");

    [Fact]
    public async Task Health_still_answers_ok_without_touching_the_database()
    {
        using var client = api.CreateClient();

        using var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Ready_is_200_when_the_database_answers()
    {
        using var client = api.CreateClient();

        using var response = await client.GetAsync("/api/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Theory]
    [InlineData(null, "Servicio no disponible")]
    [InlineData("en-US", "Service unavailable")]
    public async Task Ready_is_a_503_problem_when_the_database_is_broken(string? acceptLanguage, string title)
    {
        await using var broken = new ApiFactory();
        using var client = broken.CreateClient();
        await broken.BreakDatabaseAsync();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health/ready");
        if (acceptLanguage is not null)
        {
            request.Headers.Add("Accept-Language", acceptLanguage);
        }

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Accept-Language", response.Headers.Vary);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            (503, title, "problem.unavailable"),
            (problem.GetProperty("status").GetInt32(), problem.GetProperty("title").GetString(), problem.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task The_healthcheck_command_exits_0_when_ready_answers_200()
    {
        using var error = new StringWriter();

        var exitCode = await HealthCheckCommand.RunAsync(ReadyUrl, api.Server.CreateHandler(), HealthCheckCommand.RequestTimeout, error);

        Assert.Equal(0, exitCode);
        Assert.Equal(string.Empty, error.ToString());
    }

    [Fact]
    public async Task The_healthcheck_command_exits_1_when_ready_answers_503()
    {
        await using var broken = new ApiFactory();
        using var _ = broken.CreateClient();
        await broken.BreakDatabaseAsync();
        using var error = new StringWriter();

        var exitCode = await HealthCheckCommand.RunAsync(ReadyUrl, broken.Server.CreateHandler(), HealthCheckCommand.RequestTimeout, error);

        Assert.Equal(1, exitCode);
        Assert.Contains("503", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_healthcheck_command_exits_1_when_the_api_does_not_answer()
    {
        using var error = new StringWriter();

        var refused = await HealthCheckCommand.RunAsync(ReadyUrl, new Unreachable(), HealthCheckCommand.RequestTimeout, error);
        var hung = await HealthCheckCommand.RunAsync(ReadyUrl, new Hung(), TimeSpan.FromMilliseconds(100), error);

        Assert.Equal((1, 1), (refused, hung));
    }

    /// <summary>Like a closed port: the connection fails right away.</summary>
    private sealed class Unreachable : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("Connection refused.");
    }

    /// <summary>Like a hung process: it never answers (only the timeout stops it).</summary>
    private sealed class Hung : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException("Unreachable.");
        }
    }
}
