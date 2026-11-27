namespace Blog.Application.Media;

/// <summary>
/// Identifies the format of an image by its first bytes ("magic bytes"), not by the extension or the Content-Type,
/// which are controlled by whoever uploads the file. Only raster formats are accepted: SVG is left out on purpose
/// because it can carry scripts.
/// </summary>
public static class ImageSniffer
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] Gif87 = "GIF87a"u8.ToArray();
    private static readonly byte[] Gif89 = "GIF89a"u8.ToArray();

    /// <returns>The extension without a dot ("png", "jpg", "gif", "webp", "avif") or null if it is not a supported image.</returns>
    public static string? DetectExtension(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith(Png)) return "png";
        if (data.StartsWith(Jpeg)) return "jpg";
        if (data.StartsWith(Gif87) || data.StartsWith(Gif89)) return "gif";

        // WebP: "RIFF" + 4 size bytes + "WEBP"
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "webp";
        }

        // AVIF: "ftyp" box at byte 4 with brand "avif" or "avis" at byte 8
        if (data.Length >= 12 && data.Slice(4, 4).SequenceEqual("ftyp"u8))
        {
            var brand = data.Slice(8, 4);
            if (brand.SequenceEqual("avif"u8) || brand.SequenceEqual("avis"u8))
            {
                return "avif";
            }
        }

        return null;
    }
}
