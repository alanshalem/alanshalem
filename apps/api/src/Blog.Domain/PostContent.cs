namespace Blog.Domain;

/// <summary>
/// The editable content of a post, validated and normalized.
/// It is the only way to create or change a post: if an instance exists, it is valid.
/// </summary>
public sealed record PostContent(
    string Title,
    string Slug,
    string Summary,
    string Body,
    IReadOnlyList<string> Tags,
    string? CoverUrl = null,
    string? CoverAlt = null)
{
    public const int MaxTitleLength = 200;
    public const int MaxSummaryLength = 400;
    public const int MaxBodyLength = 500_000;
    public const int MaxTags = 10;
    public const int MaxTagLength = 40;
    public const int MaxCoverAltLength = 300;

    /// <param name="coverUrl">Optional cover: a /media/... path (uploaded from the admin) or an http(s) URL. Empty = no cover.</param>
    /// <param name="coverAlt">Alternative text of the cover. Empty = null.</param>
    public static PostContent Create(
        string? title,
        string? slug,
        string? summary,
        string? body,
        IEnumerable<string>? tags,
        string? coverUrl = null,
        string? coverAlt = null)
    {
        var cleanTitle = (title ?? string.Empty).Trim();
        if (cleanTitle.Length == 0)
        {
            throw new DomainException(MessageKeys.PostTitleRequired);
        }

        if (cleanTitle.Length > MaxTitleLength)
        {
            throw new DomainException(MessageKeys.PostTitleTooLong, ("max", MaxTitleLength));
        }

        // Without an explicit slug it is derived from the title.
        var cleanSlug = string.IsNullOrWhiteSpace(slug) ? Domain.Slug.From(cleanTitle) : slug.Trim();
        if (!Domain.Slug.IsValid(cleanSlug))
        {
            throw new DomainException(MessageKeys.PostSlugInvalid, ("max", Domain.Slug.MaxLength));
        }

        var cleanSummary = (summary ?? string.Empty).Trim();
        if (cleanSummary.Length > MaxSummaryLength)
        {
            throw new DomainException(MessageKeys.PostSummaryTooLong, ("max", MaxSummaryLength));
        }

        var cleanBody = body ?? string.Empty;
        if (cleanBody.Length > MaxBodyLength)
        {
            throw new DomainException(MessageKeys.PostBodyTooLong, ("max", MaxBodyLength));
        }

        var cleanTags = (tags ?? [])
            .Select(tag => tag.Trim())
            .Where(tag => tag.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (cleanTags.Count > MaxTags)
        {
            throw new DomainException(MessageKeys.PostTooManyTags, ("max", MaxTags));
        }

        if (cleanTags.Any(tag => tag.Length > MaxTagLength))
        {
            throw new DomainException(MessageKeys.PostTagTooLong, ("max", MaxTagLength));
        }

        var cleanCoverUrl = OptionalText.Clean(coverUrl, WebUrl.MaxLength, MessageKeys.PostCoverUrlTooLong);
        if (cleanCoverUrl is not null && !WebUrl.IsImageUrl(cleanCoverUrl))
        {
            throw new DomainException(MessageKeys.PostCoverUrlInvalid);
        }

        var cleanCoverAlt = OptionalText.Clean(coverAlt, MaxCoverAltLength, MessageKeys.PostCoverAltTooLong);

        return new PostContent(cleanTitle, cleanSlug, cleanSummary, cleanBody, cleanTags, cleanCoverUrl, cleanCoverAlt);
    }
}
