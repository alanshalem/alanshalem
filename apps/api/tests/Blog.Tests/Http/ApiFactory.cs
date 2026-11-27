using System.Net;
using Blog.Api.Security;
using Blog.Application.Abstractions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Tests.Http;

/// <summary>
/// The whole API in memory (TestServer), built by the same Program.cs, with database, media, work folder and cookie keys
/// in a temporary folder of its own. Only the builder (counts requests) and ffmpeg (simulated: the HTTP tests do not
/// need it) are replaced. Runs as Production; <see cref="Development"/> is the same API in Development.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string Password = "test password";
    public const string BuilderToken = "builder-token-for-http-tests-0123456789";

    /// <summary>The anti-CSRF header the middleware requires on every request that changes data.</summary>
    public const string CsrfHeader = "X-Requested-With";
    public const string CsrfValue = "blog-admin";

    /// <summary>
    /// Tests only: the IP the connection "comes" from (TestServer has none). A middleware that runs before all of
    /// Program.cs sets it, as if it were the real IP of the socket.
    /// </summary>
    public const string RemoteIpHeader = "X-Test-Remote-Ip";

    private readonly string _directory = Path.Combine(Path.GetTempPath(), "blog-http-tests-" + Guid.NewGuid().ToString("N"));
    private WebApplicationFactory<Program>? _development;
    private HttpClient? _admin;
    private HttpClient? _developmentAdmin;

    public string MediaDirectory => Path.Combine(_directory, "media");

    /// <summary>A file outside the media folder: what a /media/../ would try to read.</summary>
    public string OutsideMediaFile => Path.Combine(_directory, "blog.db");

    internal CountingBuildTrigger Build { get; } = new();

    internal FakeVideoTranscoder Transcoder { get; } = new();

    /// <summary>Everything the API logs (also the <see cref="Development"/> one and the derived ones).</summary>
    internal CapturingLoggerProvider Logs { get; } = new();

    /// <summary>The same API (same configuration and folders) in Development, where it serves /media.</summary>
    public WebApplicationFactory<Program> Development =>
        _development ??= WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    /// <summary>Client without a session. HTTPS: the session cookie is Secure and would not travel over HTTP.</summary>
    public HttpClient CreateHttpsClient(WebApplicationFactory<Program>? factory = null) =>
        (factory ?? this).CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

    /// <summary>A client with a session, shared: the login is rate limited (10 attempts every 15 minutes per IP).</summary>
    public async Task<HttpClient> AdminClientAsync() => _admin ??= await LoggedInAsync(CreateHttpsClient());

    /// <summary>The same as <see cref="AdminClientAsync"/> against the API in <see cref="Development"/> (it has its own limit).</summary>
    public async Task<HttpClient> DevelopmentAdminClientAsync() => _developmentAdmin ??= await LoggedInAsync(CreateHttpsClient(Development));

    /// <summary>A request that changes data, with the anti-CSRF header.</summary>
    public static HttpRequestMessage Mutation(HttpMethod method, string url, HttpContent? content = null) =>
        new(method, url) { Content = content, Headers = { { CsrfHeader, CsrfValue } } };

    public static HttpContent JsonContent(object value) => System.Net.Http.Json.JsonContent.Create(value);

    /// <summary>
    /// Breaks the database with the API running: the file becomes garbage (like a damaged disk). Only for a factory of the
    /// test's own, never for the shared one. Retries because a worker may have the file open for an instant.
    /// </summary>
    public async Task BreakDatabaseAsync()
    {
        var garbage = System.Text.Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("this is not a SQLite database. ", 200)));
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Delete(OutsideMediaFile + "-wal");
                File.Delete(OutsideMediaFile + "-shm");
                await File.WriteAllBytesAsync(OutsideMediaFile, garbage);
                return;
            }
            catch (IOException) when (attempt < 50)
            {
                await Task.Delay(100);
            }
        }
    }

    private static async Task<HttpClient> LoggedInAsync(HttpClient client)
    {
        using var response = await client.SendAsync(Mutation(HttpMethod.Post, "/api/auth/login", JsonContent(new { password = Password })));
        response.EnsureSuccessStatusCode();
        return client;
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // UseSetting comes in as the highest-priority configuration: it beats appsettings.json and the user-secrets.
        builder.UseEnvironment("Production");
        builder.UseSetting("ConnectionStrings:Blog", $"Data Source={OutsideMediaFile};Pooling=False");
        builder.UseSetting("Media:Directory", MediaDirectory);
        builder.UseSetting("Video:WorkDirectory", Path.Combine(_directory, "video-work"));
        builder.UseSetting("DataProtection:KeysDirectory", Path.Combine(_directory, "keys"));
        builder.UseSetting("Admin:PasswordHash", Pbkdf2PasswordHasher.Hash(Password, iterations: 1_000));
        builder.UseSetting("Builder:Token", BuilderToken);
        builder.UseSetting("Builder:Url", string.Empty);

        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ISiteBuildTrigger>(Build);
            services.AddSingleton<IVideoTranscoder>(Transcoder);
            services.AddSingleton<IStartupFilter, RemoteIpFromHeader>();
        });
    }
}

/// <summary>Sets as the connection IP the one of <see cref="ApiFactory.RemoteIpHeader"/>, before any API middleware.</summary>
internal sealed class RemoteIpFromHeader : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use((context, nextMiddleware) =>
        {
            if (IPAddress.TryParse(context.Request.Headers[ApiFactory.RemoteIpHeader], out var address))
            {
                context.Connection.RemoteIpAddress = address;
            }

            return nextMiddleware(context);
        });
        next(app);
    };
}

/// <summary>All the HTTP tests share a single API (starting it is expensive) and run one at a time.</summary>
[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "API HTTP";
}
