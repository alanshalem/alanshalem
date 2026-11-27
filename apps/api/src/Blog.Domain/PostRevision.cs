namespace Blog.Domain;

/// <summary>
/// Snapshot of a post's content as it was at a save. Never modified: restoring applies an old one as one more save,
/// which leaves its own new version (history is not rewritten).
/// </summary>
public sealed class PostRevision
{
    /// <summary>Versions kept per post; beyond that the oldest are deleted. Enough to undo days of editing without the body (up to 500 KB) bloating the database.</summary>
    public const int MaxPerPost = 50;

    // Constructor for EF Core (materializes the entity from the database).
    private PostRevision()
    {
        Title = Slug = Summary = Body = string.Empty;
        Tags = [];
    }

    public Guid Id { get; private set; }
    public Guid PostId { get; private set; }

    /// <summary>1, 2, 3... per post. Never reused when pruning: "version 37" is always the same one.</summary>
    public int Number { get; private set; }

    public string Title { get; private set; }
    public string Slug { get; private set; }
    public string Summary { get; private set; }
    public string Body { get; private set; }
    public IReadOnlyList<string> Tags { get; private set; }
    public string? CoverUrl { get; private set; }
    public string? CoverAlt { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>The oldest version kept once this one is saved: earlier ones are pruned.</summary>
    public int FirstKeptNumber => Math.Max(1, Number - MaxPerPost + 1);

    /// <summary>The current content of the post as its version number <paramref name="number"/>.</summary>
    public static PostRevision Capture(Post post, int number, DateTime nowUtc) => new()
    {
        Id = Guid.CreateVersion7(),
        PostId = post.Id,
        Number = number,
        Title = post.Title,
        Slug = post.Slug,
        Summary = post.Summary,
        Body = post.Body,
        Tags = [.. post.Tags], // a list of its own: the snapshot shares nothing with the live post
        CoverUrl = post.CoverUrl,
        CoverAlt = post.CoverAlt,
        CreatedAtUtc = nowUtc,
    };
}
