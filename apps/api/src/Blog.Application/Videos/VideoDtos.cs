using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

public sealed record VideoSourceDto(VideoCodec Codec, int Height, string Url, long Bytes);

/// <summary>The trim (seconds of the original) and the fade the video was processed with, already normalized.</summary>
public sealed record VideoEditDto(double TrimStart, double TrimEnd, VideoFade Fade, double FadeSeconds);

/// <summary>
/// A hero video. While <see cref="Status"/> is "processing" it has no poster or sources; the admin polls
/// GET /api/admin/media/videos/{id} until it becomes "ready" or "failed" (with <see cref="Error"/>, which the API writes
/// in the language of the request).
/// <see cref="Warnings"/> carry no text either: the API writes each one in the language of the request.
/// <see cref="DurationSeconds"/> is the final duration, with the edit already applied.
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
    IReadOnlyList<UserMessage> Warnings,
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
