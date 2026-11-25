using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>Entrada para crear o editar. Slug vacío = derivarlo del título.</summary>
public sealed record SavePostRequest(string? Title, string? Slug, string? Summary, string? Body, IReadOnlyList<string>? Tags);

public sealed record PostSummaryDto(
    Guid Id,
    string Slug,
    string Title,
    PostStatus Status,
    DateTime UpdatedAt,
    DateTime? PublishedAt);

public sealed record PostDto(
    Guid Id,
    string Slug,
    string Title,
    string Summary,
    string Body,
    IReadOnlyList<string> Tags,
    string Lang,
    PostStatus Status,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime? PublishedAt);

public static class PostMapping
{
    public static PostDto ToDto(this Post post) => new(
        post.Id,
        post.Slug,
        post.Title,
        post.Summary,
        post.Body,
        post.Tags,
        post.Lang,
        post.Status,
        post.CreatedAtUtc,
        post.UpdatedAtUtc,
        post.PublishedAtUtc);
}
