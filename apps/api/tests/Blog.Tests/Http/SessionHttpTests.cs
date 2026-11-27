using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blog.Tests.Http;

/// <summary>
/// The admin session and the login: logging out invalidates every issued cookie (a copy made earlier too), a cookie
/// without the session epoch does not get in, failed logins are logged with the client IP (without the password) and
/// X-Forwarded-For is believed only from a configured proxy network. A factory of its own: logging out here must not
/// log out the session shared by the other HTTP tests.
/// </summary>
public sealed class SessionHttpTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const string CookieName = "__Host-admin";
    private const string DockerProxy = "172.18.0.5";
    private const string DirectClient = "203.0.113.9";
    private const string RealClient = "198.51.100.7";

    [Fact]
    public async Task Logout_invalidates_a_cookie_copied_before_it_and_a_new_login_works_again()
    {
        var copied = await LoginCookieAsync();
        using var copy = CookieClient(copied);
        using var before = await copy.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        using (var owner = CookieClient(copied))
        using (var logout = await owner.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/auth/logout")))
        {
            Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        }

        using var after = await copy.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        // The rejected cookie is deleted in the browser.
        Assert.Contains(after.Headers.GetValues("Set-Cookie"), cookie => cookie.StartsWith(CookieName + "=;", StringComparison.Ordinal));

        using var again = CookieClient(await LoginCookieAsync());
        using var me = await again.GetAsync("/api/auth/me");
        using var admin = await again.GetAsync("/api/admin/posts");
        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (me.StatusCode, admin.StatusCode));
    }

    [Fact]
    public async Task A_cookie_without_the_session_epoch_is_rejected()
    {
        // Like the cookies issued before this change: valid and signed, but without the session epoch.
        var options = api.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], CookieAuthenticationDefaults.AuthenticationScheme));
        var properties = new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
        var legacy = options.TicketDataFormat.Protect(new AuthenticationTicket(principal, properties, CookieAuthenticationDefaults.AuthenticationScheme));
        using var client = CookieClient(legacy);

        using var response = await client.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Logout_without_a_session_does_not_close_the_sessions_of_others()
    {
        var cookie = await LoginCookieAsync();
        using var anonymous = api.CreateHttpsClient();
        using var logout = await anonymous.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/auth/logout"));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        using var client = CookieClient(cookie);
        using var me = await client.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task A_failed_login_is_logged_as_a_warning_with_the_client_ip_and_without_the_password()
    {
        const string attempt = "intento-equivocado-0123";
        const string client = "203.0.113.10"; // this test's own: the factory is shared by the class

        using var response = await FailedLoginAsync(api, client, forwardedFor: null, attempt);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var entry = Assert.Single(FailedLoginLogs(api, client));
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.DoesNotContain(api.Logs.Entries, logged => logged.Message.Contains(attempt, StringComparison.Ordinal));
    }

    [Fact]
    public async Task X_forwarded_for_is_believed_only_from_the_docker_proxy_networks()
    {
        using var viaProxy = await FailedLoginAsync(api, DockerProxy, RealClient, "otra");
        using var spoofed = await FailedLoginAsync(api, DirectClient, "192.0.2.66", "otra");

        Assert.Single(FailedLoginLogs(api, RealClient));
        Assert.Empty(FailedLoginLogs(api, "192.0.2.66"));
        Assert.NotEmpty(FailedLoginLogs(api, DirectClient));
    }

    [Fact]
    public async Task The_trusted_proxy_networks_come_from_configuration()
    {
        await using var configured = api.WithWebHostBuilder(builder => builder.UseSetting("ForwardedHeaders:KnownNetworks:0", "203.0.113.0/24"));

        using var fromConfigured = await FailedLoginAsync(configured, DirectClient, "192.0.2.77", "otra");
        using var fromDocker = await FailedLoginAsync(configured, DockerProxy, "192.0.2.78", "otra");

        Assert.Single(FailedLoginLogs(api, "192.0.2.77"));
        Assert.Empty(FailedLoginLogs(api, "192.0.2.78"));
        Assert.NotEmpty(FailedLoginLogs(api, DockerProxy));
    }

    private async Task<string> LoginCookieAsync()
    {
        using var client = api.CreateHttpsClient();
        using var login = await client.SendAsync(
            ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", ApiFactory.JsonContent(new { password = ApiFactory.Password })));
        Assert.Equal(HttpStatusCode.NoContent, login.StatusCode);
        var setCookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        return setCookie[(CookieName.Length + 1)..setCookie.IndexOf(';', StringComparison.Ordinal)];
    }

    /// <summary>A client that sends that cookie as is, without storing the ones it receives (like a thief with a copy).</summary>
    private HttpClient CookieClient(string cookie)
    {
        var client = api.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        client.DefaultRequestHeaders.Add("Cookie", $"{CookieName}={cookie}");
        return client;
    }

    private static Task<HttpResponseMessage> FailedLoginAsync(
        WebApplicationFactory<Program> factory, string remoteIp, string? forwardedFor, string password)
    {
        var request = ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", ApiFactory.JsonContent(new { password }));
        request.Headers.Add(ApiFactory.RemoteIpHeader, remoteIp);
        if (forwardedFor is not null)
        {
            request.Headers.Add("X-Forwarded-For", forwardedFor);
        }

        return factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") }).SendAsync(request);
    }

    private static IEnumerable<LogEntry> FailedLoginLogs(ApiFactory api, string ip) =>
        api.Logs.Entries.Where(entry =>
            entry.Category == "Blog.Api.Endpoints.AuthEndpoints" && entry.Message.Contains(ip, StringComparison.Ordinal));
}
