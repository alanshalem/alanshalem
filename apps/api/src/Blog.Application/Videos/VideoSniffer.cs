namespace Blog.Application.Videos;

/// <summary>
/// Identifica un contenedor de video por sus primeros bytes, no por la extensión ni el Content-Type. Es solo el
/// primer filtro: que realmente haya un video legible lo decide ffprobe.
/// </summary>
public static class VideoSniffer
{
    // Matroska y WebM empiezan con la cabecera EBML.
    private static readonly byte[] Ebml = [0x1A, 0x45, 0xDF, 0xA3];

    /// <summary>MP4 y MOV (caja "ftyp" en el byte 4), WebM y MKV (EBML).</summary>
    public static bool IsSupportedContainer(ReadOnlySpan<byte> head) =>
        head.StartsWith(Ebml) || (head.Length >= 8 && head.Slice(4, 4).SequenceEqual("ftyp"u8));
}
