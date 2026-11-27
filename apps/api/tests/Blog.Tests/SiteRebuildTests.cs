using System.Data.Common;
using System.Net;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;
using Blog.Infrastructure;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Tests;

/// <summary>
/// The durable rebuild: every request leaves the "pending" mark in the database and it is cleared only when the builder
/// accepted it; the background process retries (on start and on every round) with a single request per round.
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

        // Three failed requests are a single mark: the next round sends one, not three.
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((4, "pending"), (sender.Requests, await StateAsync(database)));
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((5, "pending"), (sender.Requests, await StateAsync(database)));

        sender.Accepts = true;
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((6, "clear"), (sender.Requests, await StateAsync(database)));

        // With nothing pending, the round does not bother the builder.
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

        // The already cancelled token is that of an API shutting down: the mark is stored anyway, the send does not arrive.
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
        sender.Accepts = true; // the builder came back

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
        // The API "shuts down" as soon as the database confirms the first publication: the second one never gets published.
        await using var database = await CreateDatabaseAsync(sender, services =>
            services.ConfigureDbContext<BlogDbContext>(options => options.AddInterceptors(new CancelAfterPublishedSave(stopping))));
        var first = await CreateScheduledAsync(database, "Uno", "2026-11-25T13:00:00Z");
        var second = await CreateScheduledAsync(database, "Dos", "2026-11-25T13:30:00Z");
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(3);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => database.SchedulerWorker.PublishDueAsync(stopping.Token));

        Assert.Equal(PostStatus.Published, (await database.WithPostsAsync(posts => posts.GetAsync(first, default))).Status);
        Assert.Equal(PostStatus.Draft, (await database.WithPostsAsync(posts => posts.GetAsync(second, default))).Status);
        Assert.Equal("pending", await StateAsync(database));
    }

    [Fact]
    public async Task A_failed_mark_write_is_logged_and_the_request_is_still_sent()
    {
        var sender = new FakeBuildRequestSender { Accepts = false };
        await using var database = await CreateDatabaseAsync(sender);

        // The database fails while leaving the mark: the request goes out anyway and nothing propagates (saving a post does not break because of this).
        await WithBuildStateFailingAsync(database, () => RequestBuildAsync(database));

        // The accepted cost (see MarkPendingAsync): without a mark, a builder rejection is not kept for retrying.
        Assert.Equal((1, "clear"), (sender.Requests, await StateAsync(database)));
        Assert.IsAssignableFrom<DbException>(Assert.Single(TriggerLogs(database, LogLevel.Error)).Exception);
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal(1, sender.Requests);
    }

    [Fact]
    public async Task An_accepted_request_whose_mark_cannot_be_cleared_stays_pending_and_is_sent_again()
    {
        var sender = new FakeBuildRequestSender { Accepts = true };
        await using var database = await CreateDatabaseAsync(sender);

        // The builder accepts, but the database stops answering right before clearing the mark.
        sender.Respond(async _ =>
        {
            await database.ExecuteAsync(DisableBuildState);
            return true;
        });
        await RequestBuildAsync(database);
        await database.ExecuteAsync(EnableBuildState);

        Assert.Equal((1, "pending"), (sender.Requests, await StateAsync(database)));
        Assert.IsAssignableFrom<DbException>(Assert.Single(TriggerLogs(database, LogLevel.Warning)).Exception);

        // At most one extra regeneration, never one too few: the next round sends it and now it is cleared.
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((2, "clear"), (sender.Requests, await StateAsync(database)));
    }

    [Fact]
    public async Task The_ok_of_an_older_request_does_not_clear_a_newer_pending_one()
    {
        var sender = new FakeBuildRequestSender();
        await using var database = await CreateDatabaseAsync(sender);
        var olderInFlight = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var olderAnswer = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        sender.Respond(async _ =>
        {
            olderInFlight.SetResult();
            return await olderAnswer.Task;
        });
        sender.Respond(_ => Task.FromResult(false)); // the newest one: the builder rejects it

        var older = RequestBuildAsync(database);
        await olderInFlight.Task.WaitAsync(WaitLimit);
        await RequestBuildAsync(database); // replaces the mark while the earlier one is still in flight
        olderAnswer.SetResult(true); // only now does the OK of the earlier one arrive
        await older.WaitAsync(WaitLimit);

        Assert.Equal((2, "pending"), (sender.Requests, await StateAsync(database)));

        // Only the OK of the request that is pending clears it.
        sender.Accepts = true;
        await database.RebuildWorker.RetryPendingAsync(default);
        Assert.Equal((3, "clear"), (sender.Requests, await StateAsync(database)));
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
        Assert.IsType<HttpBuildRequestSender>(scope.ServiceProvider.GetRequiredService<IBuildRequestSender>());
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
        var unreachable = new StubHandler(_ => throw new HttpRequestException("no network"));
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
        var handler = new StubHandler(_ => throw new InvalidOperationException("should not be called"));
        var sender = new HttpBuildRequestSender(
            new HttpClient(handler), Options.Create(new BuilderOptions { Url = "" }), NullLogger<HttpBuildRequestSender>.Instance);

        Assert.True(await sender.SendAsync(default));
        Assert.Null(handler.LastUri);
    }

    private static HttpBuildRequestSender Sender(StubHandler handler, TimeSpan? timeout = null) => new(
        new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(5) },
        Options.Create(new BuilderOptions { Url = "http://builder:4000/", Token = "secreto" }),
        NullLogger<HttpBuildRequestSender>.Instance);

    /// <summary>The real database with the production trigger and the simulated send to the builder.</summary>
    private static async Task<SqliteTestDatabase> CreateDatabaseAsync(FakeBuildRequestSender sender, Action<IServiceCollection>? configure = null)
    {
        var database = new SqliteTestDatabase(services =>
        {
            services.AddSingleton<IBuildRequestSender>(sender);
            // SqliteTestDatabase sets a counter as ISiteBuildTrigger; here the production one comes back.
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

    // Without the table, every read or write of the state fails with a real SQLite DbException.
    private const string DisableBuildState = "ALTER TABLE site_build_state RENAME TO site_build_state_off";
    private const string EnableBuildState = "ALTER TABLE site_build_state_off RENAME TO site_build_state";

    private static async Task WithBuildStateFailingAsync(SqliteTestDatabase database, Func<Task> action)
    {
        await database.ExecuteAsync(DisableBuildState);
        try
        {
            await action();
        }
        finally
        {
            await database.ExecuteAsync(EnableBuildState);
        }
    }

    private static IEnumerable<LogEntry> TriggerLogs(SqliteTestDatabase database, LogLevel level) =>
        database.Logs.Entries.Where(entry => entry.Category == typeof(DurableSiteBuildTrigger).FullName && entry.Level == level);

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
            Assert.True(DateTime.UtcNow < deadline, "The background process did not finish in time.");
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

    /// <summary>
    /// Cancels the token as soon as the database confirms the save of a published post: a shutdown at an exact point,
    /// taken from the save and not from what the log says.
    /// </summary>
    private sealed class CancelAfterPublishedSave(CancellationTokenSource source) : SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context?.ChangeTracker.Entries<Post>().Any(entry => entry.Entity.Status == PostStatus.Published) == true)
            {
                source.Cancel();
            }

            return ValueTask.FromResult(result);
        }
    }
}
