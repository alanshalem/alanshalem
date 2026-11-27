namespace Blog.Application.Videos;

/// <summary>
/// Identifies a video container by its first bytes, not by the extension or the Content-Type. It is only the first
/// filter: whether there really is a readable video is decided by ffprobe.
/// </summary>
public static class VideoSniffer
{
    // Matroska and WebM start with the EBML header.
    private static readonly byte[] Ebml = [0x1A, 0x45, 0xDF, 0xA3];

    /// <summary>MP4 and MOV ("ftyp" box at byte 4), WebM and MKV (EBML).</summary>
    public static bool IsSupportedContainer(ReadOnlySpan<byte> head) =>
        head.StartsWith(Ebml) || (head.Length >= 8 && head.Slice(4, 4).SequenceEqual("ftyp"u8));
}
