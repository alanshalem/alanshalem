namespace Blog.Domain;

public enum VideoCodec
{
    Av1,
    H264,
}

/// <summary>
/// An optimized version of a hero video: codec and height in pixels. Which heights and codecs are generated lives here,
/// once (how each one is encoded is a detail of the ffmpeg adapter).
/// </summary>
public sealed record VideoVariant(VideoCodec Codec, int Height)
{
    /// <summary>720p for phones and 1080p for desktop: each device downloads only the one it needs.</summary>
    public static IReadOnlyList<int> StandardHeights { get; } = [720, 1080];

    /// <summary>AV1 first (much lighter); H.264 as the fallback for browsers that do not decode AV1.</summary>
    public static IReadOnlyList<VideoCodec> Codecs { get; } = [VideoCodec.Av1, VideoCodec.H264];

    public string CodecName => Codec switch
    {
        VideoCodec.Av1 => "av1",
        VideoCodec.H264 => "h264",
        _ => throw new ArgumentOutOfRangeException(nameof(Codec), Codec, "Unknown video codec."),
    };

    /// <summary>
    /// The standard heights that do not exceed the original: a video is never enlarged (it would only weigh more
    /// without looking better). The hero size rule guarantees at least 720 of height, so there is always one.
    /// </summary>
    public static IReadOnlyList<int> HeightsFor(int sourceHeight) => [.. StandardHeights.Where(height => height <= sourceHeight)];

    /// <summary>All the versions of a video of that height: each codec at each height.</summary>
    public static IReadOnlyList<VideoVariant> For(int sourceHeight) =>
        [.. Codecs.SelectMany(codec => HeightsFor(sourceHeight).Select(height => new VideoVariant(codec, height)))];
}

/// <summary>A generated video file: its version and its size (the admin shows it; the site does not need it).</summary>
public sealed record VideoSource(VideoCodec Codec, int Height, long Bytes)
{
    public VideoVariant Variant => new(Codec, Height);
}
