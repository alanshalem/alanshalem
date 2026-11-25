namespace Blog.Domain;

public enum VideoCodec
{
    Av1,
    H264,
}

/// <summary>
/// Una versión optimizada de un video del hero: códec y alto en píxeles. Acá vive, una sola vez, qué altos y códecs
/// se generan (cómo se codifica cada uno es un detalle del adaptador de ffmpeg).
/// </summary>
public sealed record VideoVariant(VideoCodec Codec, int Height)
{
    /// <summary>720p para celulares y 1080p para escritorio: cada dispositivo baja solo la que le sirve.</summary>
    public static IReadOnlyList<int> StandardHeights { get; } = [720, 1080];

    /// <summary>AV1 primero (pesa bastante menos); H.264 de respaldo para los navegadores que no decodifican AV1.</summary>
    public static IReadOnlyList<VideoCodec> Codecs { get; } = [VideoCodec.Av1, VideoCodec.H264];

    public string CodecName => Codec switch
    {
        VideoCodec.Av1 => "av1",
        VideoCodec.H264 => "h264",
        _ => throw new ArgumentOutOfRangeException(nameof(Codec), Codec, "Códec de video desconocido."),
    };

    /// <summary>
    /// Los altos estándar que no superan el original: nunca se agranda un video (solo pesaría más sin verse mejor).
    /// La regla de tamaño del hero garantiza al menos 720 de alto, así que siempre hay uno.
    /// </summary>
    public static IReadOnlyList<int> HeightsFor(int sourceHeight) => [.. StandardHeights.Where(height => height <= sourceHeight)];

    /// <summary>Todas las versiones de un video de ese alto: cada códec en cada alto.</summary>
    public static IReadOnlyList<VideoVariant> For(int sourceHeight) =>
        [.. Codecs.SelectMany(codec => HeightsFor(sourceHeight).Select(height => new VideoVariant(codec, height)))];
}

/// <summary>Un archivo de video ya generado: su versión y cuánto pesa (lo muestra el admin; el sitio no lo necesita).</summary>
public sealed record VideoSource(VideoCodec Codec, int Height, long Bytes)
{
    public VideoVariant Variant => new(Codec, Height);
}
