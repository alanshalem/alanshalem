namespace Blog.Application.Media;

/// <summary>
/// Identifica el formato de una imagen por sus primeros bytes ("magic bytes"), no por la extensión ni por el
/// Content-Type, que los controla quien sube el archivo. Se aceptan solo formatos raster: SVG queda afuera a
/// propósito porque puede llevar scripts.
/// </summary>
public static class ImageSniffer
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] Gif87 = "GIF87a"u8.ToArray();
    private static readonly byte[] Gif89 = "GIF89a"u8.ToArray();

    /// <returns>La extensión sin punto ("png", "jpg", "gif", "webp", "avif") o null si no es una imagen soportada.</returns>
    public static string? DetectExtension(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith(Png)) return "png";
        if (data.StartsWith(Jpeg)) return "jpg";
        if (data.StartsWith(Gif87) || data.StartsWith(Gif89)) return "gif";

        // WebP: "RIFF" + 4 bytes de tamaño + "WEBP"
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "webp";
        }

        // AVIF: caja "ftyp" en el byte 4 con marca "avif" o "avis" en el 8
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
