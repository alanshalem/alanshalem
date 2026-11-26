using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

public sealed record VideoSourceDto(VideoCodec Codec, int Height, string Url, long Bytes);

/// <summary>El recorte (segundos del original) y el fundido con que se procesó el video, ya normalizados.</summary>
public sealed record VideoEditDto(double TrimStart, double TrimEnd, VideoFade Fade, double FadeSeconds);

/// <summary>
/// Un video del hero. Mientras <see cref="Status"/> es "processing" no tiene póster ni fuentes; el admin consulta
/// GET /api/admin/media/videos/{id} hasta que pase a "ready" o "failed" (con <see cref="Error"/>, que la API escribe en
/// el idioma del pedido).
/// <see cref="DurationSeconds"/> es la duración final, ya aplicada la edición.
/// </summary>
public sealed record VideoAssetDto(
    Guid Id,
    VideoStatus Status,
    StoredMessage? Error,
    int Width,
    int Height,
    double DurationSeconds,
    VideoEditDto Edit,
    MediaAssetDto? Poster,
    IReadOnlyList<VideoSourceDto> Sources,
    IReadOnlyList<string> Warnings,
    DateTime CreatedAt);

public static class VideoMapping
{
    public static VideoAssetDto ToDto(this VideoAsset video) => new(
        video.Id,
        video.Status,
        video.Error is { } error ? new StoredMessage(error) : null,
        video.Width,
        video.Height,
        video.DurationSeconds,
        new VideoEditDto(video.Edit.TrimStart, video.Edit.TrimEnd, video.Edit.Fade, video.Edit.FadeSeconds),
        video.Poster?.ToDto(),
        video.Sources.Select(source => new VideoSourceDto(source.Codec, source.Height, video.UrlOf(source.Variant), source.Bytes)).ToList(),
        video.Warnings,
        video.CreatedAtUtc);
}
