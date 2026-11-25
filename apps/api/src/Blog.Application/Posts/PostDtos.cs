using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>
/// Entrada para crear o editar. Slug vacío = derivarlo del título. La portada es opcional: si no viene en el JSON
/// queda en null (el sitio cae a la primera imagen del cuerpo o a una portada generativa). El idioma solo se elige al
/// crear (sin él, español); al editar puede omitirse o repetirse, pero no cambiarse.
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

/// <summary>Pide la versión del post en otro idioma.</summary>
public sealed record CreateTranslationRequest(string? Lang);

/// <summary>Otra versión del mismo artículo (mismo grupo de traducción, otro idioma).</summary>
public sealed record PostTranslationDto(Guid Id, string Lang, string Slug, PostStatus Status, DateTime UpdatedAt);

/// <param name="Translations">Las otras versiones del grupo; vacío si no hay.</param>
public sealed record PostSummaryDto(
    Guid Id,
    string Slug,
    string Title,
    string Lang,
    Guid TranslationGroupId,
    PostStatus Status,
    DateTime UpdatedAt,
    DateTime? PublishedAt,
    string? CoverUrl,
    string? CoverAlt,
    IReadOnlyList<PostTranslationDto> Translations);

/// <param name="Translations">Las otras versiones del grupo; vacío si no hay.</param>
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
    DateTime? PublishedAt,
    string? CoverUrl,
    string? CoverAlt,
    IReadOnlyList<PostTranslationDto> Translations);

public static class PostMapping
{
    /// <param name="versions">Las versiones del grupo; puede incluir al propio post (se descarta).</param>
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
        post.PublishedAtUtc,
        post.CoverUrl,
        post.CoverAlt,
        OthersThan(post.Id, versions));

    public static PostTranslationDto ToTranslation(this Post post) =>
        new(post.Id, post.Lang, post.Slug, post.Status, post.UpdatedAtUtc);

    public static PostTranslationDto ToTranslation(this PostSummaryDto summary) =>
        new(summary.Id, summary.Lang, summary.Slug, summary.Status, summary.UpdatedAt);

    /// <summary>Las versiones que no son la del post, por idioma: un orden estable para el admin y el sitio.</summary>
    public static IReadOnlyList<PostTranslationDto> OthersThan(Guid postId, IEnumerable<PostTranslationDto> versions) =>
        versions.Where(version => version.Id != postId).OrderBy(version => version.Lang, StringComparer.Ordinal).ToList();
}
