namespace Blog.Domain;

/// <summary>
/// El contenido editable de un post, ya validado y normalizado.
/// Es el único camino para crear o modificar un post: si existe una instancia, es válida.
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

    /// <param name="coverUrl">Portada opcional: ruta /media/... (subida desde el admin) o URL http(s). Vacía = sin portada.</param>
    /// <param name="coverAlt">Texto alternativo de la portada. Vacío = null.</param>
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

        // Sin slug explícito se deriva del título.
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
