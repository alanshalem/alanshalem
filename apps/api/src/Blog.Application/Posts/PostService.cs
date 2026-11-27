using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>
/// Post use cases. Every change that affects what the public sees triggers a site regeneration, and every save that
/// changes the content leaves a version in the history.
/// </summary>
public sealed class PostService(IPostRepository posts, IClock clock, ISiteBuildTrigger siteBuild)
{
    public async Task<IReadOnlyList<PostSummaryDto>> ListAsync(CancellationToken cancellationToken)
    {
        // The list already has every version: they are linked to each other without another query.
        var summaries = await posts.ListSummariesAsync(cancellationToken);
        var groups = summaries.ToLookup(summary => summary.TranslationGroupId, summary => summary.ToTranslation());
        return summaries
            .Select(summary => summary with { Translations = PostMapping.OthersThan(summary.Id, groups[summary.TranslationGroupId]) })
            .ToList();
    }

    public async Task<PostDto> GetAsync(Guid id, CancellationToken cancellationToken) =>
        await ToDtoAsync(await FindAsync(id, cancellationToken), cancellationToken);

    public async Task<PostDto> CreateAsync(SavePostRequest request, CancellationToken cancellationToken)
    {
        var post = Post.CreateDraft(ToContent(request), request.Lang ?? Language.Default, clock.UtcNow);
        await EnsureSlugIsFreeAsync(post.Lang, post.Slug, excludingId: null, cancellationToken);

        posts.Add(post);
        await RecordRevisionAsync(post, cancellationToken);
        await posts.SaveChangesAsync(cancellationToken);

        // A new draft is not visible to the public: no need to regenerate.
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UpdateAsync(Guid id, SavePostRequest request, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        if (request.Lang is not null && Language.Parse(request.Lang) != post.Lang)
        {
            throw new DomainException(MessageKeys.PostLanguageImmutable);
        }

        var content = ToContent(request);
        await EnsureSlugIsFreeAsync(post.Lang, content.Slug, excludingId: id, cancellationToken);

        if (post.Update(content, clock.UtcNow))
        {
            await RecordRevisionAsync(post, cancellationToken);
        }

        await posts.SaveChangesAsync(cancellationToken);

        if (post.Status == PostStatus.Published)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>
    /// Creates the draft of the version in another language by copying the post's content (the translation is manual,
    /// on top of the copy). A draft is not seen on the site: nothing is regenerated.
    /// </summary>
    /// <exception cref="ConflictException">
    /// If the group already has that version, or if another post in that language uses both the copied slug and the
    /// same one with the language suffix.
    /// </exception>
    public async Task<PostDto> CreateTranslationAsync(Guid id, CreateTranslationRequest request, CancellationToken cancellationToken)
    {
        var source = await FindAsync(id, cancellationToken);
        var now = clock.UtcNow; // one single time: if the suffix is needed, the version is born with that slug and is not "edited" later
        var translation = source.CreateTranslation(request.Lang, now);

        // One version per language in each group. The unique index (TranslationGroupId, Lang) covers the race between two requests.
        var versions = await posts.ListVersionsAsync(source.TranslationGroupId, cancellationToken);
        if (versions.Any(version => version.Lang == translation.Lang))
        {
            throw new ConflictException(MessageKeys.PostTranslationExists, ("language", Language.NameOf(translation.Lang)));
        }

        // The copied slug may belong to another article in the target language (two unrelated posts with the same slug):
        // it is tried once with the language suffix; if that is taken too, it is the usual conflict.
        if (await posts.SlugExistsAsync(translation.Lang, translation.Slug, excludingId: null, cancellationToken))
        {
            translation.SuffixSlugWithLanguage(now);
            await EnsureSlugIsFreeAsync(translation.Lang, translation.Slug, excludingId: null, cancellationToken);
        }

        posts.Add(translation);
        await RecordRevisionAsync(translation, cancellationToken);
        await posts.SaveChangesAsync(cancellationToken);
        return translation.ToDto(versions);
    }

    /// <exception cref="NotFoundException">If the post does not exist.</exception>
    public async Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid id, CancellationToken cancellationToken)
    {
        await FindAsync(id, cancellationToken);
        return await posts.ListRevisionsAsync(id, cancellationToken);
    }

    public async Task<PostRevisionDto> GetRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken) =>
        (await FindRevisionAsync(id, revisionId, cancellationToken)).ToDto();

    /// <summary>
    /// Returns the post to that version with a normal save: same validations (slug free in its language, limits), same
    /// rebuild if it is published, and a new version in the history. Later versions are not touched.
    /// </summary>
    public async Task<PostDto> RestoreRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken)
    {
        var revision = await FindRevisionAsync(id, revisionId, cancellationToken);
        return await UpdateAsync(id, revision.ToRequest(), cancellationToken);
    }

    /// <summary>A scheduled draft is not seen on the site until it is published: nothing is regenerated.</summary>
    public async Task<PostDto> ScheduleAsync(Guid id, SchedulePostRequest request, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Schedule(request.ParsePublishAtUtc(), clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UnscheduleAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Unschedule(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>The scheduled drafts that are already due, to publish them one by one with <see cref="PublishIfDueAsync"/>.</summary>
    public Task<IReadOnlyList<Guid>> ListDueAsync(CancellationToken cancellationToken) =>
        posts.ListDueAsync(clock.UtcNow, cancellationToken);

    /// <summary>
    /// Publishes a scheduled post through the same path as manual publishing, if it is still due: between the list and
    /// here it may have been published by hand, cancelled or deleted. It does not regenerate: whoever publishes the batch
    /// requests a single rebuild at the end.
    /// </summary>
    /// <returns>Whether it published it.</returns>
    public async Task<bool> PublishIfDueAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await posts.GetByIdAsync(id, cancellationToken);
        if (post is null || !post.IsDue(clock.UtcNow))
        {
            return false;
        }

        post.Publish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<PostDto> PublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Publish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        await siteBuild.RequestBuildAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UnpublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        post.Unpublish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>Deletes only this version: the others in the group stay (if one is left, the group goes on with it).</summary>
    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        posts.Remove(post);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }
    }

    /// <summary>
    /// What the Astro builder consumes: every published post, with its body. Each one is linked only to its published
    /// versions: the site never links to a draft.
    /// </summary>
    public async Task<IReadOnlyList<PostDto>> ListPublishedAsync(CancellationToken cancellationToken)
    {
        var published = await posts.ListPublishedAsync(cancellationToken);
        var groups = published.ToLookup(post => post.TranslationGroupId, post => post.ToTranslation());
        return published.Select(post => post.ToDto(groups[post.TranslationGroupId])).ToList();
    }

    private async Task<Post> FindAsync(Guid id, CancellationToken cancellationToken) =>
        await posts.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(MessageKeys.PostNotFound);

    private async Task<PostRevision> FindRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken)
    {
        await FindAsync(id, cancellationToken);
        return await posts.GetRevisionAsync(id, revisionId, cancellationToken) ?? throw new NotFoundException(MessageKeys.PostRevisionNotFound);
    }

    // The snapshot of the current content as the next version, pruning those beyond PostRevision.MaxPerPost. It is
    // committed in the same SaveChanges as the post: there is never a save without its version or the other way around.
    private async Task RecordRevisionAsync(Post post, CancellationToken cancellationToken)
    {
        var number = await posts.LatestRevisionNumberAsync(post.Id, cancellationToken) + 1;
        var revision = PostRevision.Capture(post, number, clock.UtcNow);
        posts.AddRevision(revision);
        await posts.RemoveRevisionsBeforeAsync(post.Id, revision.FirstKeptNumber, cancellationToken);
    }

    private async Task<PostDto> ToDtoAsync(Post post, CancellationToken cancellationToken) =>
        post.ToDto(await posts.ListVersionsAsync(post.TranslationGroupId, cancellationToken));

    private static PostContent ToContent(SavePostRequest request) =>
        PostContent.Create(request.Title, request.Slug, request.Summary, request.Body, request.Tags, request.CoverUrl, request.CoverAlt);

    // The slug is unique per language: the same URL can exist under /es/ and under /en/.
    private async Task EnsureSlugIsFreeAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken)
    {
        if (await posts.SlugExistsAsync(lang, slug, excludingId, cancellationToken))
        {
            throw new ConflictException(MessageKeys.PostSlugTaken, ("language", Language.NameOf(lang)), ("slug", slug));
        }
    }
}
