using System.Net;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;
using Blog.Infrastructure;
using Blog.Infrastructure.Build;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Tests;

/// <summary>
/// El rebuild durable: cada pedido deja la marca "pendiente" en la base y solo se borra cuando el builder lo aceptó;
/// el proceso en segundo plano reintenta (al arrancar y en cada vuelta) con un solo pedido por vuelta.
/// </summary>
public class SiteRebuildTests
{
    private static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task A_rejected_request_stays_pending_and_each_retry_sends_exactly_one_request()
    {
        var sender = new FakeBuildRequestSender { Accepts = false };
        await using var database = await CreateDatabaseAsync(sender);

        await RequestBuildAsync(database);
        await RequestBuildAsync(database);
        await RequestBuildAsync(database);
        Assert.Equal((3, "pending"), (sender.Requests, await StateAsync(database)));

        // Tres pedidos fallidos son una sola marca: la vuelta siguiente manda uno, no tres.
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((4, "pending"), (sender.Requests, await StateAsync(database)));
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((5, "pending"), (sender.Requests, await StateAsync(database)));

        sender.Accepts = true;
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((6, "clear"), (sender.Requests, await StateAsync(database)));

        // Sin nada pendiente, la vuelta no molesta al builder.
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal(6, sender.Requests);
    }

    [Fact]
    public async Task An_accepted_request_clears_the_mark()
    {
        var sender = new FakeBuildRequestSender { Accepts = true };
        await using var database = await CreateDatabaseAsync(sender);
        Assert.Equal("clear", await StateAsync(database));

        await RequestBuildAsync(database);

        Assert.Equal((1, "clear"), (sender.Requests, await StateAsync(database)));
    }

    [Fact]
    public async Task A_request_cut_by_the_host_stopping_stays_pending()
    {
        var sender = new FakeBuildRequestSender { Accepts = true };
        await using var database = await CreateDatabaseAsync(sender);

        // El token ya cancelado es el de una API que se está apagando: la marca se guarda igual, el envío no llega.
        await RequestBuildAsync(database, new CancellationToken(canceled: true));

        Assert.Equal("pending", await StateAsync(database));
    }

    [Fact]
    public async Task On_start_the_worker_retries_a_pending_rebuild_left_by_a_previous_run()
    {
        var sender = new FakeBuildRequestSender { Accepts = false };
        await using var database = await CreateDatabaseAsync(sender);
        await RequestBuildAsync(database);
        Assert.Equal("pending", await StateAsync(database));
        sender.Accepts = true; // el builder volvió

        await database.RebuildWorker.StartAsync(default);
        try
        {
            await WaitUntilAsync(async () => await StateAsync(database) == "clear");
        }
        finally
        {
            await database.RebuildWorker.StopAsync(default);
        }

        Assert.Equal(2, sender.Requests);
        Assert.Equal(TimeSpan.FromMinutes(1), SiteRebuildWorker.Interval);
    }

    [Fact]
    public async Task Scheduled_publishing_requests_the_rebuild_through_the_durable_path()
    {
        var sender = new FakeBuildRequestSender { Accepts = false };
        await using var database = await CreateDatabaseAsync(sender);
        await CreateScheduledAsync(database, "Uno", "2026-11-25T13:00:00Z");
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(3);

        Assert.Equal(1, await database.SchedulerWorker.PublishDueAsync(default));

        Assert.Equal((1, "pending"), (sender.Requests, await StateAsync(database)));
    }

    [Fact]
    public async Task Posts_published_before_the_host_stops_mid_batch_still_leave_the_rebuild_pending()
    {
        var sender = new FakeBuildRequestSender { Accepts = true };
        using var stopping = new CancellationTokenSource();
        // Se "apaga" la API justo después de publicar el primero: el segundo ya no llega a publicarse.
        await using var database = await CreateDatabaseAsync(
            sender, services => services.AddSingleton<ILoggerProvider>(new CancelOnLogProvider(stopping, "Se publicó el post programado")));
        var first = await CreateScheduledAsync(database, "Uno", "2026-11-25T13:00:00Z");
        var second = await CreateScheduledAsync(database, "Dos", "2026-11-25T13:30:00Z");
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(3);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => database.SchedulerWorker.PublishDueAsync(stopping.Token));

        Assert.Equal(PostStatus.Published, (await database.WithPostsAsync(posts => posts.GetAsync(first, default))).Status);
        Assert.Equal(PostStatus.Draft, (await database.WithPostsAsync(posts => posts.GetAsync(second, default))).Status);
        Assert.Equal("pending", await StateAsync(database));
    }

    [Fact]
    public async Task Infrastructure_registers_the_durable_trigger_for_every_use_case()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Blog"] = "Data Source=:memory:" })
            .Build();
        await using var provider = new ServiceCollection().AddLogging().AddInfrastructure(configuration).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();

        Assert.IsType<DurableSiteBuildTrigger>(scope.ServiceProvider.GetRequiredService<ISiteBuildTrigger>());
        Assert.IsType<HttpSiteBuildTrigger>(scope.ServiceProvider.GetRequiredService<IBuildRequestSender>());
    }

    [Theory]
    [InlineData(HttpStatusCode.Accepted, true)]
    [InlineData(HttpStatusCode.OK, true)]
    [InlineData(HttpStatusCode.InternalServerError, false)]
    [InlineData(HttpStatusCode.Unauthorized, false)]
    public async Task The_http_sender_reports_whether_the_builder_accepted(HttpStatusCode status, bool accepted)
    {
        var handler = new StubHandler(_ => Task.FromResult(new HttpResponseMessage(status)));

        Assert.Equal(accepted, await Sender(handler).SendAsync(default));
        Assert.Equal(("http://builder:4000/build", "Bearer"), (handler.LastUri, handler.LastScheme));
    }

    [Fact]
    public async Task The_http_sender_reports_an_unreachable_or_slow_builder_as_not_accepted()
    {
        var unreachable = new StubHandler(_ => throw new HttpRequestException("sin red"));
        var slow = new StubHandler(async token =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), token);
            return new HttpResponseMessage(HttpStatusCode.Accepted);
        });

        Assert.False(await Sender(unreachable).SendAsync(default));
        Assert.False(await Sender(slow, TimeSpan.FromMilliseconds(50)).SendAsync(default));
    }

    [Fact]
    public async Task Without_a_builder_url_there_is_nothing_to_retry()
    {
        var handler = new StubHandler(_ => throw new InvalidOperationException("no debería llamarse"));
        var sender = new HttpSiteBuildTrigger(
            new HttpClient(handler), Options.Create(new BuilderOptions { Url = "" }), NullLogger<HttpSiteBuildTrigger>.Instance);

        Assert.True(await sender.SendAsync(default));
        Assert.Null(handler.LastUri);
    }

    private static HttpSiteBuildTrigger Sender(StubHandler handler, TimeSpan? timeout = null) => new(
        new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(5) },
        Options.Create(new BuilderOptions { Url = "http://builder:4000/", Token = "secreto" }),
        NullLogger<HttpSiteBuildTrigger>.Instance);

    /// <summary>La base real con el trigger de producción y el envío al builder simulado.</summary>
    private static async Task<SqliteTestDatabase> CreateDatabaseAsync(FakeBuildRequestSender sender, Action<IServiceCollection>? configure = null)
    {
        var database = new SqliteTestDatabase(services =>
        {
            services.AddSingleton<IBuildRequestSender>(sender);
            // SqliteTestDatabase pone un contador como ISiteBuildTrigger; acá se vuelve al de producción.
            services.AddScoped<ISiteBuildTrigger>(provider => provider.GetRequiredService<DurableSiteBuildTrigger>());
            configure?.Invoke(services);
        });
        await database.InitializeAsync();
        return database;
    }

    private static Task RequestBuildAsync(SqliteTestDatabase database, CancellationToken cancellationToken = default) =>
        database.InScopeAsync(async provider =>
        {
            await provider.GetRequiredService<ISiteBuildTrigger>().RequestBuildAsync(cancellationToken);
            return true;
        });

    private static async Task<string> StateAsync(SqliteTestDatabase database) =>
        Assert.Single(await database.ListAsync("SELECT CASE WHEN PendingRequestId IS NULL THEN 'clear' ELSE 'pending' END FROM site_build_state"));

    private static async Task<Guid> CreateScheduledAsync(SqliteTestDatabase database, string title, string publishAt)
    {
        var post = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest(title, null, null, "cuerpo", null), default));
        await database.WithPostsAsync(posts => posts.ScheduleAsync(post.Id, new SchedulePostRequest(publishAt), default));
        return post.Id;
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var deadline = DateTime.UtcNow + WaitLimit;
        while (!await condition())
        {
            Assert.True(DateTime.UtcNow < deadline, "El proceso en segundo plano no terminó a tiempo.");
            await Task.Delay(50);
        }
    }

    private sealed class StubHandler(Func<CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public string? LastUri { get; private set; }

        public string? LastScheme { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastUri = request.RequestUri?.ToString();
            LastScheme = request.Headers.Authorization?.Scheme;
            return respond(cancellationToken);
        }
    }

    /// <summary>Cancela el token cuando se registra un mensaje que contiene el texto: un apagado en un punto exacto.</summary>
    private sealed class CancelOnLogProvider(CancellationTokenSource source, string text) : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName) => new CancelOnLog(source, text);

        public void Dispose()
        {
        }

        private sealed class CancelOnLog(CancellationTokenSource source, string text) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                if (formatter(state, exception).Contains(text, StringComparison.Ordinal))
                {
                    source.Cancel();
                }
            }
        }
    }
}
