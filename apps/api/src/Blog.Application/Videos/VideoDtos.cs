using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

public sealed record VideoSourceDto(VideoCodec Codec, int Height, string Url, long Bytes);

/// <summary>
/// Un video del hero. Mientras <see cref="Status"/> es "processing" no tiene póster ni fuentes; el admin consulta
/// GET /api/admin/media/videos/{id} hasta que pase a "ready" o "failed" (con <see cref="Error"/>).
/// </summary>
public sealed record VideoAssetDto(
    Guid Id,
    VideoStatus Status,
    string? Error,
    int Width,
    int Height,
    double DurationSeconds,
    MediaAssetDto? Poster,
    IReadOnlyList<VideoSourceDto> Sources,
    IReadOnlyList<string> Warnings,
    DateTime CreatedAt);

public static class VideoMapping
{
    public static VideoAssetDto ToDto(this VideoAsset video) => new(
        video.Id,
        video.Status,
        video.Error,
        video.Width,
        video.Height,
        video.DurationSeconds,
        video.Poster?.ToDto(),
        video.Sources.Select(source => new VideoSourceDto(source.Codec, source.Height, video.UrlOf(source.Variant), source.Bytes)).ToList(),
        video.Warnings,
        video.CreatedAtUtc);
}
