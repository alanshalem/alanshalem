using System.Globalization;
using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>
/// Input to create or edit. Empty slug = derive it from the title. The cover is optional: if it is not in the JSON it
/// stays null (the site falls back to the first body image or a generated cover). The language is chosen only on
/// creation (without it, Spanish); when editing it can be omitted or repeated, but not changed.
/// </summary>
public sealed record SavePostRequest(
    string? Title,
    string? Slug,
    string? Summary,
    string? Body,
    IReadOnlyList<string>? Tags,
    string? CoverUrl = null,
    string? CoverAlt = null,
    string? Lang = null);

/// <summary>Requests the post's version in another language.</summary>
public sealed record CreateTranslationRequest(string? Lang);

/// <param name="PublishAt">ISO 8601 with a time zone (Z or ±hh:mm). It arrives as text to answer 400 with a message of its own if it cannot be read.</param>
public sealed record SchedulePostRequest(string? PublishAt)
{
    /// <summary>The requested time in UTC.</summary>
    /// <exception cref="DomainException">If it is missing or has no time zone: without one the time is ambiguous (the admin's or the server's?).</exception>
    public DateTime ParsePublishAtUtc()
    {
        if (string.IsNullOrWhiteSpace(PublishAt))
        {
            throw new DomainException(MessageKeys.PostPublishAtRequired);
        }

        // AdjustToUniversal converts to UTC using the text's offset; if there is none, the result stays Unspecified.
        if (!DateTime.TryParse(PublishAt, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var parsed)
            || parsed.Kind != DateTimeKind.Utc)
        {
            throw new DomainException(MessageKeys.PostPublishAtInvalid);
        }

        return parsed;
    }
}

/// <summary>A history version in the list: without the body (the admin requests it when opening it).</summary>
/// <param name="BodyLength">Characters of the body: a hint of its size without fetching it.</param>
public sealed record PostRevisionSummaryDto(Guid Id, int Number, DateTime CreatedAt, string Title, int BodyLength);

/// <summary>A complete history version: what the admin compares with the current post (the admin does the comparison).</summary>
public sealed record PostRevisionDto(
    Guid Id,
    int Number,
    DateTime CreatedAt,
    string Title,
    string Slug,
    string Summary,
    string Body,
    IReadOnlyList<string> Tags,
    string? CoverUrl,
    string? CoverAlt);

/// <summary>Another version of the same article (same translation group, another language).</summary>
/// <param name="ContentUpdatedAt">Last change of its content (<see cref="Post.ContentUpdatedAtUtc"/>): with this date, and not with <paramref name="UpdatedAt"/>, the admin knows whether the translation fell behind.</param>
public sealed record PostTranslationDto(Guid Id, string Lang, string Slug, PostStatus Status, DateTime UpdatedAt, DateTime ContentUpdatedAt);

/// <param name="Translations">The other versions of the group; empty if there are none.</param>
public sealed record PostSummaryDto(
    Guid Id,
    string Slug,
    string Title,
    string Lang,
    Guid TranslationGroupId,
    PostStatus Status,
    DateTime UpdatedAt,
    DateTime ContentUpdatedAt,
    DateTime? PublishedAt,
    DateTime? ScheduledAt,
    string? CoverUrl,
    string? CoverAlt,
    IReadOnlyList<PostTranslationDto> Translations);

/// <param name="Translations">The other versions of the group; empty if there are none.</param>
public sealed record PostDto(
    Guid Id,
    string Slug,
    string Title,
    string Summary,
    string Body,
    IReadOnlyList<string> Tags,
    string Lang,
    Guid TranslationGroupId,
    PostStatus Status,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime ContentUpdatedAt,
    DateTime? PublishedAt,
    DateTime? ScheduledAt,
    string? CoverUrl,
    string? CoverAlt,
    IReadOnlyList<PostTranslationDto> Translations);

public static class PostMapping
{
    /// <param name="versions">The versions of the group; it may include the post itself (it is discarded).</param>
    public static PostDto ToDto(this Post post, IEnumerable<PostTranslationDto> versions) => new(
        post.Id,
        post.Slug,
        post.Title,
        post.Summary,
        post.Body,
        post.Tags,
        post.Lang,
        post.TranslationGroupId,
        post.Status,
        post.CreatedAtUtc,
        post.UpdatedAtUtc,
        post.ContentUpdatedAtUtc,
        post.PublishedAtUtc,
        post.ScheduledAtUtc,
        post.CoverUrl,
        post.CoverAlt,
        OthersThan(post.Id, versions));

    public static PostRevisionDto ToDto(this PostRevision revision) => new(
        revision.Id,
        revision.Number,
        revision.CreatedAtUtc,
        revision.Title,
        revision.Slug,
        revision.Summary,
        revision.Body,
        revision.Tags,
        revision.CoverUrl,
        revision.CoverAlt);

    /// <summary>The version as if the admin saved it again: restoring goes through the same validations as editing.</summary>
    public static SavePostRequest ToRequest(this PostRevision revision) =>
        new(revision.Title, revision.Slug, revision.Summary, revision.Body, revision.Tags, revision.CoverUrl, revision.CoverAlt);

    public static PostTranslationDto ToTranslation(this Post post) =>
        new(post.Id, post.Lang, post.Slug, post.Status, post.UpdatedAtUtc, post.ContentUpdatedAtUtc);

    public static PostTranslationDto ToTranslation(this PostSummaryDto summary) =>
        new(summary.Id, summary.Lang, summary.Slug, summary.Status, summary.UpdatedAt, summary.ContentUpdatedAt);

    /// <summary>The versions other than the post's, by language: a stable order for the admin and the site.</summary>
    public static IReadOnlyList<PostTranslationDto> OthersThan(Guid postId, IEnumerable<PostTranslationDto> versions) =>
        versions.Where(version => version.Id != postId).OrderBy(version => version.Lang, StringComparer.Ordinal).ToList();
}
