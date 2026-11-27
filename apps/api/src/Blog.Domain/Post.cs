namespace Blog.Domain;

/// <summary>
/// A blog article in one language. Its versions in other languages are other posts of the same
/// <see cref="TranslationGroupId"/>, each with its own content, slug and status. All dates are UTC.
/// </summary>
public sealed class Post
{
    // Constructor for EF Core (materializes the entity from the database).
    private Post()
    {
        Slug = Title = Summary = Body = Lang = string.Empty;
        Tags = [];
    }

    public Guid Id { get; private set; }
    public string Slug { get; private set; }
    public string Title { get; private set; }
    public string Summary { get; private set; }
    public string Body { get; private set; }
    public IReadOnlyList<string> Tags { get; private set; }

    /// <summary>Cover chosen in the admin (/media/... or http(s)). Null = the site uses the first body image or a generated one.</summary>
    public string? CoverUrl { get; private set; }

    public string? CoverAlt { get; private set; }

    /// <summary>Language of the content (<see cref="Language"/>). Fixed at creation: another language is another version (<see cref="CreateTranslation"/>).</summary>
    public string Lang { get; private set; }

    /// <summary>Joins the versions of the same article in different languages: at most one per language.</summary>
    public Guid TranslationGroupId { get; private set; }

    public PostStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Last change of any kind: content, status or schedule. Sorts the admin list.</summary>
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>
    /// Last change of the content (creation included). Publishing, unpublishing or scheduling do not move it: it is the
    /// reference to tell whether a translation fell behind its original, and a status change leaves nothing new to
    /// translate.
    /// </summary>
    public DateTime ContentUpdatedAtUtc { get; private set; }

    /// <summary>First time it was published. Kept if the post is unpublished and published again.</summary>
    public DateTime? PublishedAtUtc { get; private set; }

    /// <summary>When it publishes itself (UTC). Only a draft has it: publishing, by hand or by the schedule, clears it.</summary>
    public DateTime? ScheduledAtUtc { get; private set; }

    /// <summary>A new article: it starts its own translation group.</summary>
    /// <exception cref="DomainException">If the language is not one of <see cref="Language"/>.</exception>
    public static Post CreateDraft(PostContent content, string lang, DateTime nowUtc) =>
        NewDraft(Language.Parse(lang), Guid.CreateVersion7(), content, nowUtc);

    /// <summary>
    /// The draft of this article in another language, in the same group, with the content copied as is as a starting
    /// point: translation is manual and published separately. The cover is copied and independent afterwards.
    /// </summary>
    /// <exception cref="DomainException">If the language is invalid or is the one of this post.</exception>
    public Post CreateTranslation(string? lang, DateTime nowUtc)
    {
        var target = Language.Parse(lang);
        if (target == Lang)
        {
            throw new DomainException(MessageKeys.PostAlreadyInLanguage, ("language", Language.NameOf(Lang)));
        }

        return NewDraft(target, TranslationGroupId, CurrentContent(), nowUtc);
    }

    /// <summary>
    /// For the newly created version whose copied slug is already used by another article in its language: "my-post"
    /// becomes "my-post-en", so creating the version does not fail over a slug that will be translated anyway. It is
    /// one more content change.
    /// </summary>
    public void SuffixSlugWithLanguage(DateTime nowUtc) =>
        Update(CurrentContent() with { Slug = Domain.Slug.WithSuffix(Slug, Lang) }, nowUtc);

    /// <summary>
    /// Saves the content. It always counts as an update (<see cref="UpdatedAtUtc"/>), but only a different content
    /// moves <see cref="ContentUpdatedAtUtc"/>: an identical save leaves nothing new to translate.
    /// </summary>
    /// <returns>Whether the content changed: an identical save does not deserve a new version in the history either.</returns>
    public bool Update(PostContent content, DateTime nowUtc)
    {
        var changed = !HasContent(content);
        Apply(content, nowUtc);
        if (changed)
        {
            ContentUpdatedAtUtc = nowUtc;
        }

        return changed;
    }

    public void Publish(DateTime nowUtc)
    {
        Status = PostStatus.Published;
        PublishedAtUtc ??= nowUtc;
        ScheduledAtUtc = null;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>Schedules the publication. Replaces any previous date.</summary>
    /// <exception cref="DomainException">If the post is already published or the date is not in the future.</exception>
    public void Schedule(DateTime publishAtUtc, DateTime nowUtc)
    {
        if (Status == PostStatus.Published)
        {
            throw new DomainException(MessageKeys.PostScheduleAlreadyPublished);
        }

        if (publishAtUtc <= nowUtc)
        {
            throw new DomainException(MessageKeys.PostScheduleInPast);
        }

        ScheduledAtUtc = publishAtUtc;
        UpdatedAtUtc = nowUtc;
    }

    public void Unschedule(DateTime nowUtc)
    {
        ScheduledAtUtc = null;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>A scheduled draft whose time has come (or passed, if the API was down).</summary>
    public bool IsDue(DateTime nowUtc) => Status == PostStatus.Draft && ScheduledAtUtc <= nowUtc;

    public void Unpublish(DateTime nowUtc)
    {
        Status = PostStatus.Draft;
        UpdatedAtUtc = nowUtc;
    }

    private static Post NewDraft(string lang, Guid translationGroupId, PostContent content, DateTime nowUtc)
    {
        var post = new Post
        {
            Id = Guid.CreateVersion7(), // time-ordered: behaves well as a primary key
            Lang = lang,
            TranslationGroupId = translationGroupId,
            Status = PostStatus.Draft,
            CreatedAtUtc = nowUtc,
            ContentUpdatedAtUtc = nowUtc,
        };
        post.Apply(content, nowUtc);
        return post;
    }

    // It is already valid content (it came from a PostContent): copied without validating again. The tags in a list of
    // their own, so editing the copy (another version, another slug) never touches this post.
    private PostContent CurrentContent() => new(Title, Slug, Summary, Body, [.. Tags], CoverUrl, CoverAlt);

    private bool HasContent(PostContent content) =>
        Title == content.Title
        && Slug == content.Slug
        && Summary == content.Summary
        && Body == content.Body
        && Tags.SequenceEqual(content.Tags, StringComparer.Ordinal)
        && CoverUrl == content.CoverUrl
        && CoverAlt == content.CoverAlt;

    private void Apply(PostContent content, DateTime nowUtc)
    {
        Title = content.Title;
        Slug = content.Slug;
        Summary = content.Summary;
        Body = content.Body;
        Tags = content.Tags;
        CoverUrl = content.CoverUrl;
        CoverAlt = content.CoverAlt;
        UpdatedAtUtc = nowUtc;
    }
}
