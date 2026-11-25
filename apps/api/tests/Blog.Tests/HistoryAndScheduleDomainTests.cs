using Blog.Domain;

namespace Blog.Tests;

public class PostRevisionTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    private static PostContent Content(string body = "cuerpo", params string[] tags) =>
        PostContent.Create("Hola", "hola", "Resumen", body, tags, "/media/a.png", "Alt");

    [Fact]
    public void Update_reports_whether_the_content_changed()
    {
        var post = Post.CreateDraft(Content("cuerpo", "net"), "es", Now);

        Assert.False(post.Update(Content("cuerpo", "net"), Now));
        Assert.True(post.Update(Content("cuerpo", "net", "ia"), Now));
        Assert.True(post.Update(Content("otro", "net", "ia"), Now));
        Assert.Equal("otro", post.Body);
    }

    [Fact]
    public void Capture_snapshots_the_whole_content_with_its_number_and_time()
    {
        var post = Post.CreateDraft(Content("cuerpo", "net"), "es", Now);

        var revision = PostRevision.Capture(post, 7, Now.AddMinutes(1));

        Assert.Equal((post.Id, 7, Now.AddMinutes(1)), (revision.PostId, revision.Number, revision.CreatedAtUtc));
        Assert.Equal(
            ("Hola", "hola", "Resumen", "cuerpo", "/media/a.png", "Alt"),
            (revision.Title, revision.Slug, revision.Summary, revision.Body, revision.CoverUrl, revision.CoverAlt));
        Assert.Equal(["net"], revision.Tags);
        Assert.NotEqual(Guid.Empty, revision.Id);
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(PostRevision.MaxPerPost, 1)]
    [InlineData(PostRevision.MaxPerPost + 1, 2)]
    [InlineData(120, 120 - PostRevision.MaxPerPost + 1)]
    public void Each_post_keeps_only_its_latest_revisions(int number, int firstKept)
    {
        var post = Post.CreateDraft(Content(), "es", Now);

        Assert.Equal(firstKept, PostRevision.Capture(post, number, Now).FirstKeptNumber);
        Assert.Equal(50, PostRevision.MaxPerPost);
    }
}

public class PostScheduleTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    private static Post Draft() => Post.CreateDraft(PostContent.Create("Hola", null, null, "cuerpo", null), "es", Now);

    [Fact]
    public void A_draft_can_be_scheduled_in_the_future_becomes_due_at_that_time_and_can_be_cancelled()
    {
        var post = Draft();

        post.Schedule(Now.AddHours(1), Now);

        Assert.Equal(Now.AddHours(1), post.ScheduledAtUtc);
        Assert.False(post.IsDue(Now.AddMinutes(59)));
        Assert.True(post.IsDue(Now.AddHours(1)));
        post.Unschedule(Now);
        Assert.Null(post.ScheduledAtUtc);
        Assert.False(post.IsDue(Now.AddHours(2)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void A_time_that_is_not_in_the_future_is_rejected_and_keeps_the_previous_schedule(int minutes)
    {
        var post = Draft();
        post.Schedule(Now.AddDays(1), Now);

        var error = Assert.Throws<DomainException>(() => post.Schedule(Now.AddMinutes(minutes), Now));

        Assert.Equal(Http.ScheduleMessages.Past, error.Message);
        Assert.Equal(Now.AddDays(1), post.ScheduledAtUtc);
    }

    [Fact]
    public void A_published_post_cannot_be_scheduled_and_is_never_due()
    {
        var post = Draft();
        post.Publish(Now);

        var error = Assert.Throws<DomainException>(() => post.Schedule(Now.AddDays(1), Now));

        Assert.Equal(Http.ScheduleMessages.Published, error.Message);
        Assert.Null(post.ScheduledAtUtc);
        Assert.False(post.IsDue(Now.AddDays(2)));
    }

    [Fact]
    public void Publishing_clears_the_schedule()
    {
        var post = Draft();
        post.Schedule(Now.AddDays(1), Now);

        post.Publish(Now);

        Assert.Null(post.ScheduledAtUtc);
        Assert.Equal(PostStatus.Published, post.Status);
    }
}
