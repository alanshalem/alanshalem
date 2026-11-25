using Blog.Application.Posts;
using Blog.Domain;
using Blog.Infrastructure.Scheduling;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

/// <summary>Historial y programación contra la base SQLite real (índices, cascada, conversiones de fechas).</summary>
public class HistoryPersistenceTests
{
    [Fact]
    public async Task Revisions_and_the_schedule_round_trip_and_deleting_the_post_deletes_its_revisions()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var post = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hola", null, "R", "uno", ["net"]), default));
        await database.WithPostsAsync(posts => posts.UpdateAsync(post.Id, new SavePostRequest("Hola", "hola", "R", "dos", ["net"]), default));
        var other = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Otro", null, null, "x", null), default));

        var scheduled = await database.WithPostsAsync(posts => posts.ScheduleAsync(post.Id, new SchedulePostRequest("2026-12-01T09:30:00Z"), default));
        var revisions = await database.WithPostsAsync(posts => posts.ListRevisionsAsync(post.Id, default));
        var first = await database.WithPostsAsync(posts => posts.GetRevisionAsync(post.Id, revisions[^1].Id, default));

        Assert.Equivalent(scheduled, await database.WithPostsAsync(posts => posts.GetAsync(post.Id, default)), strict: true);
        Assert.Equal(new DateTime(2026, 12, 1, 9, 30, 0, DateTimeKind.Utc), scheduled.ScheduledAt);
        Assert.Equal([(2, 3), (1, 3)], revisions.Select(revision => (revision.Number, revision.BodyLength)));
        Assert.Equal(("uno", DateTimeKind.Utc), (first.Body, first.CreatedAt.Kind));
        Assert.Equal(["net"], first.Tags);

        await database.WithPostsAsync(async posts =>
        {
            await posts.DeleteAsync(post.Id, default);
            return true;
        });

        // La cascada de la clave foránea: solo queda la versión del otro post.
        Assert.Equal([other.Id.ToString().ToUpperInvariant()], await database.ListAsync("SELECT PostId FROM post_revisions"));
    }

    [Fact]
    public async Task Pruning_keeps_only_the_latest_revisions_in_the_database()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var post = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hola", null, null, "0", null), default));

        for (var number = 2; number <= PostRevision.MaxPerPost + 2; number++)
        {
            await database.WithPostsAsync(posts => posts.UpdateAsync(post.Id, new SavePostRequest("Hola", "hola", null, $"{number}", null), default));
        }

        var revisions = await database.WithPostsAsync(posts => posts.ListRevisionsAsync(post.Id, default));
        Assert.Equal(Enumerable.Range(3, PostRevision.MaxPerPost).Reverse(), revisions.Select(revision => revision.Number));
    }
}

/// <summary>El proceso en segundo plano tal como lo registra AddInfrastructure, con el reloj y el builder de la prueba.</summary>
public class ScheduledPublishingTests
{
    private static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task On_start_it_catches_up_publishing_only_the_overdue_drafts_with_a_single_rebuild()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var first = await CreateScheduledAsync(database, "Uno", "2026-11-25T13:00:00Z");
        var second = await CreateScheduledAsync(database, "Dos", "2026-11-25T14:00:00Z");
        var later = await CreateScheduledAsync(database, "Tres", "2026-11-30T00:00:00Z");
        var plain = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Cuatro", null, null, "c", null), default));
        // Como si la API hubiera estado apagada mientras vencían los dos primeros.
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(3);

        await database.SchedulerWorker.StartAsync(default);
        try
        {
            await WaitUntilAsync(async () => (await database.WithPostsAsync(posts => posts.ListPublishedAsync(default))).Count == 2);
        }
        finally
        {
            await database.SchedulerWorker.StopAsync(default);
        }

        foreach (var id in new[] { first, second })
        {
            var post = await database.WithPostsAsync(posts => posts.GetAsync(id, default));
            Assert.Equal((PostStatus.Published, (DateTime?)null, (DateTime?)database.Clock.UtcNow), (post.Status, post.ScheduledAt, post.PublishedAt));
        }

        var pending = await database.WithPostsAsync(posts => posts.GetAsync(later, default));
        Assert.Equal((PostStatus.Draft, (DateTime?)new DateTime(2026, 11, 30, 0, 0, 0, DateTimeKind.Utc)), (pending.Status, pending.ScheduledAt));
        Assert.Equal(PostStatus.Draft, (await database.WithPostsAsync(posts => posts.GetAsync(plain.Id, default))).Status);
        Assert.Equal(1, database.Build.Requests);
    }

    [Fact]
    public async Task A_post_that_fails_to_publish_is_logged_and_does_not_stop_the_others()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var first = await CreateScheduledAsync(database, "Uno", "2026-11-25T13:00:00Z");
        var failing = await CreateScheduledAsync(database, "Falla", "2026-11-25T13:30:00Z");
        var third = await CreateScheduledAsync(database, "Tres", "2026-11-25T14:00:00Z");
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(3);
        // Una falla real de la base, solo para ese post.
        await database.ExecuteAsync($"""
            CREATE TRIGGER fail_publish BEFORE UPDATE OF Status ON posts WHEN NEW.Id = '{failing.ToString().ToUpperInvariant()}'
            BEGIN SELECT RAISE(ABORT, 'falla simulada'); END;
            """);

        var published = await database.SchedulerWorker.PublishDueAsync(default);

        Assert.Equal(2, published);
        var failed = await database.WithPostsAsync(posts => posts.GetAsync(failing, default));
        Assert.Equal((PostStatus.Draft, true), (failed.Status, failed.ScheduledAt.HasValue));
        Assert.Equal(PostStatus.Published, (await database.WithPostsAsync(posts => posts.GetAsync(first, default))).Status);
        Assert.Equal(PostStatus.Published, (await database.WithPostsAsync(posts => posts.GetAsync(third, default))).Status);
        Assert.Equal(1, database.Build.Requests);
        // EF registra por su lado el comando que falló; acá importa el registro del worker.
        var error = Assert.Single(database.Logs.Entries, entry => entry.Category == typeof(ScheduledPublishingWorker).FullName && entry.Level >= LogLevel.Warning);
        Assert.Equal(LogLevel.Error, error.Level);
        Assert.Contains(failing.ToString(), error.Message, StringComparison.Ordinal);
        Assert.NotNull(error.Exception);
    }

    [Fact]
    public async Task With_nothing_due_it_publishes_nothing_and_does_not_rebuild()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        await CreateScheduledAsync(database, "Después", "2026-11-30T00:00:00Z");

        Assert.Equal(0, await database.SchedulerWorker.PublishDueAsync(default));
        Assert.Equal(0, database.Build.Requests);
        Assert.Equal(TimeSpan.FromSeconds(30), ScheduledPublishingWorker.Interval);
    }

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
}
