using System.Globalization;
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

/// <param name="PublishAt">ISO 8601 con zona horaria (Z o ±hh:mm). Llega como texto para responder 400 con un mensaje propio si no se entiende.</param>
public sealed record SchedulePostRequest(string? PublishAt)
{
    /// <summary>La hora pedida en UTC.</summary>
    /// <exception cref="DomainException">Si falta o no trae zona horaria: sin ella la hora es ambigua (¿la del admin o la del servidor?).</exception>
    public DateTime ParsePublishAtUtc()
    {
        if (string.IsNullOrWhiteSpace(PublishAt))
        {
            throw new DomainException(MessageKeys.PostPublishAtRequired);
        }

        // AdjustToUniversal pasa a UTC usando el desplazamiento del texto; si no hay, el resultado queda Unspecified.
        if (!DateTime.TryParse(PublishAt, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var parsed)
            || parsed.Kind != DateTimeKind.Utc)
        {
            throw new DomainException(MessageKeys.PostPublishAtInvalid);
        }

        return parsed;
    }
}

/// <summary>Una versión del historial en la lista: sin el cuerpo (el admin lo pide al abrirla).</summary>
/// <param name="BodyLength">Caracteres del cuerpo: una pista del tamaño sin traerlo.</param>
public sealed record PostRevisionSummaryDto(Guid Id, int Number, DateTime CreatedAt, string Title, int BodyLength);

/// <summary>Una versión completa del historial: lo que el admin compara con el post actual (la comparación la hace él).</summary>
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

/// <summary>Otra versión del mismo artículo (mismo grupo de traducción, otro idioma).</summary>
/// <param name="ContentUpdatedAt">Último cambio de su contenido (<see cref="Post.ContentUpdatedAtUtc"/>): con esta fecha, y no con <paramref name="UpdatedAt"/>, el admin sabe si la traducción quedó atrás.</param>
public sealed record PostTranslationDto(Guid Id, string Lang, string Slug, PostStatus Status, DateTime UpdatedAt, DateTime ContentUpdatedAt);

/// <param name="Translations">Las otras versiones del grupo; vacío si no hay.</param>
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
    DateTime ContentUpdatedAt,
    DateTime? PublishedAt,
    DateTime? ScheduledAt,
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

    /// <summary>La versión como si el admin la volviera a guardar: restaurar pasa por las mismas validaciones que editar.</summary>
    public static SavePostRequest ToRequest(this PostRevision revision) =>
        new(revision.Title, revision.Slug, revision.Summary, revision.Body, revision.Tags, revision.CoverUrl, revision.CoverAlt);

    public static PostTranslationDto ToTranslation(this Post post) =>
        new(post.Id, post.Lang, post.Slug, post.Status, post.UpdatedAtUtc, post.ContentUpdatedAtUtc);

    public static PostTranslationDto ToTranslation(this PostSummaryDto summary) =>
        new(summary.Id, summary.Lang, summary.Slug, summary.Status, summary.UpdatedAt, summary.ContentUpdatedAt);

    /// <summary>Las versiones que no son la del post, por idioma: un orden estable para el admin y el sitio.</summary>
    public static IReadOnlyList<PostTranslationDto> OthersThan(Guid postId, IEnumerable<PostTranslationDto> versions) =>
        versions.Where(version => version.Id != postId).OrderBy(version => version.Lang, StringComparer.Ordinal).ToList();
}
