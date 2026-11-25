namespace Blog.Domain;

/// <summary>
/// El contenido editable de un post, ya validado y normalizado.
/// Es el único camino para crear o modificar un post: si existe una instancia, es válida.
/// </summary>
public sealed record PostContent(string Title, string Slug, string Summary, string Body, IReadOnlyList<string> Tags)
{
    public const int MaxTitleLength = 200;
    public const int MaxSummaryLength = 400;
    public const int MaxBodyLength = 500_000;
    public const int MaxTags = 10;
    public const int MaxTagLength = 40;

    public static PostContent Create(string? title, string? slug, string? summary, string? body, IEnumerable<string>? tags)
    {
        var cleanTitle = (title ?? string.Empty).Trim();
        if (cleanTitle.Length == 0)
        {
            throw new DomainException("El título es obligatorio.");
        }

        if (cleanTitle.Length > MaxTitleLength)
        {
            throw new DomainException($"El título no puede superar {MaxTitleLength} caracteres.");
        }

        // Sin slug explícito se deriva del título.
        var cleanSlug = string.IsNullOrWhiteSpace(slug) ? Domain.Slug.From(cleanTitle) : slug.Trim();
        if (!Domain.Slug.IsValid(cleanSlug))
        {
            throw new DomainException(
                $"El slug solo admite minúsculas, números y guiones (máx. {Domain.Slug.MaxLength}). Ejemplo: mi-primer-post.");
        }

        var cleanSummary = (summary ?? string.Empty).Trim();
        if (cleanSummary.Length > MaxSummaryLength)
        {
            throw new DomainException($"El resumen no puede superar {MaxSummaryLength} caracteres.");
        }

        var cleanBody = body ?? string.Empty;
        if (cleanBody.Length > MaxBodyLength)
        {
            throw new DomainException($"El contenido no puede superar {MaxBodyLength} caracteres.");
        }

        var cleanTags = (tags ?? [])
            .Select(tag => tag.Trim())
            .Where(tag => tag.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (cleanTags.Count > MaxTags)
        {
            throw new DomainException($"Máximo {MaxTags} etiquetas.");
        }

        if (cleanTags.Any(tag => tag.Length > MaxTagLength))
        {
            throw new DomainException($"Cada etiqueta puede tener hasta {MaxTagLength} caracteres.");
        }

        return new PostContent(cleanTitle, cleanSlug, cleanSummary, cleanBody, cleanTags);
    }
}
