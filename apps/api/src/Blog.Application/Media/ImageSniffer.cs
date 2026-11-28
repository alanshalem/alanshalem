using System.Buffers.Binary;

namespace Blog.Application.Media;

/// <summary>
/// Identifies the format of an image by its first bytes ("magic bytes"), not by the extension or the Content-Type,
/// which are controlled by whoever uploads the file. Raster formats plus SVG, which is accepted only to be rasterized:
/// the pipeline stores AVIF and WebP and never the SVG itself, so its scripts never reach a browser. An SVG that
/// declares XML entities or an internal DTD is not recognized (entity expansion bombs never reach the XML parser).
/// </summary>
public static class ImageSniffer
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] Gif87 = "GIF87a"u8.ToArray();
    private static readonly byte[] Gif89 = "GIF89a"u8.ToArray();
    private static readonly byte[] TiffLittleEndian = [0x49, 0x49, 0x2A, 0x00];
    private static readonly byte[] TiffBigEndian = [0x4D, 0x4D, 0x00, 0x2A];
    private static readonly byte[] Utf8Bom = [0xEF, 0xBB, 0xBF];
    private static readonly byte[] JxlCodestream = [0xFF, 0x0A];
    private static readonly byte[] JxlContainer = [0x00, 0x00, 0x00, 0x0C, .. "JXL \r\n"u8, 0x87, 0x0A];

    // HEIF brands of HEVC-coded images and sequences (ISO/IEC 23008-12). AVIF uses "avif"/"avis".
    private static readonly string[] HevcBrands = ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"];

    // BITMAPCOREHEADER, BITMAPINFOHEADER and its V2-V5 successors: "BM" followed by text is not a bitmap.
    private static readonly uint[] BmpHeaderSizes = [12, 40, 52, 56, 64, 108, 124];

    /// <returns>
    /// The extension without a dot ("png", "jpg", "gif", "webp", "avif", "tif", "svg") or null if it is not a supported
    /// image.
    /// </returns>
    public static string? DetectExtension(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith(Png)) return "png";
        if (data.StartsWith(Jpeg)) return "jpg";
        if (data.StartsWith(Gif87) || data.StartsWith(Gif89)) return "gif";
        if (data.StartsWith(TiffLittleEndian) || data.StartsWith(TiffBigEndian)) return "tif";

        // WebP: "RIFF" + 4 size bytes + "WEBP"
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "webp";
        }

        // AVIF: "ftyp" box at byte 4 with brand "avif" or "avis" at byte 8
        if (MajorBrand(data) is "avif" or "avis")
        {
            return "avif";
        }

        return IsSvg(data) ? "svg" : null;
    }

    /// <summary>
    /// The name of an image format recognized by its magic bytes that the server cannot decode (its libvips has no
    /// loader for it), so the user is told which format it is instead of a generic "unsupported" message.
    /// </summary>
    /// <returns>"HEIC", "BMP", "ICO" or "JPEG XL"; null for anything else (decodable formats included).</returns>
    public static string? UndecodableFormatName(ReadOnlySpan<byte> data)
    {
        if (IsHevcHeif(data)) return "HEIC";
        if (data.StartsWith(JxlContainer) || data.StartsWith(JxlCodestream)) return "JPEG XL";

        if (data.Length >= 18 && data.StartsWith("BM"u8)
            && BmpHeaderSizes.Contains(BinaryPrimitives.ReadUInt32LittleEndian(data[14..])))
        {
            return "BMP";
        }

        // ICO (type 1) or CUR (type 2): reserved 0, type, at least one image.
        if (data.Length >= 6 && data[0] == 0 && data[1] == 0 && data[2] is 1 or 2 && data[3] == 0
            && BinaryPrimitives.ReadUInt16LittleEndian(data[4..]) > 0)
        {
            return "ICO";
        }

        return null;
    }

    private static string? MajorBrand(ReadOnlySpan<byte> data) =>
        data.Length >= 12 && data.Slice(4, 4).SequenceEqual("ftyp"u8) ? System.Text.Encoding.ASCII.GetString(data.Slice(8, 4)) : null;

    /// <summary>HEIF with an HEVC brand as the major brand or, under a generic one (mif1, msf1), as a compatible brand.</summary>
    private static bool IsHevcHeif(ReadOnlySpan<byte> data)
    {
        var major = MajorBrand(data);
        if (major is null) return false;
        if (HevcBrands.Contains(major)) return true;
        if (major is not ("mif1" or "msf1")) return false;

        // Compatible brands: from byte 16 to the end of the ftyp box (bounded by the data actually read).
        var boxEnd = Math.Min(data.Length, (int)Math.Min(int.MaxValue, BinaryPrimitives.ReadUInt32BigEndian(data)));
        for (var offset = 16; offset + 4 <= boxEnd; offset += 4)
        {
            if (HevcBrands.Contains(System.Text.Encoding.ASCII.GetString(data.Slice(offset, 4)))) return true;
        }

        return false;
    }

    /// <summary>
    /// An XML document whose root element is &lt;svg&gt;: optional BOM, XML declaration, comments, whitespace and a
    /// DOCTYPE without an internal subset may come before it. Anything declaring entities is refused.
    /// </summary>
    private static bool IsSvg(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith(Utf8Bom)) data = data[Utf8Bom.Length..];
        if (data.IndexOf("<!ENTITY"u8) >= 0) return false;

        var rest = data;
        while (true)
        {
            rest = rest.TrimStart(" \t\r\n"u8);
            if (rest.StartsWith("<?xml"u8))
            {
                if (!SkipPast(ref rest, "?>"u8)) return false;
            }
            else if (rest.StartsWith("<!--"u8))
            {
                if (!SkipPast(ref rest, "-->"u8)) return false;
            }
            else if (rest.StartsWith("<!DOCTYPE"u8))
            {
                var end = rest.IndexOf((byte)'>');
                if (end < 0 || rest[..end].IndexOf((byte)'[') >= 0) return false; // internal subset: refused
                rest = rest[(end + 1)..];
            }
            else
            {
                break;
            }
        }

        return rest.StartsWith("<svg"u8) && rest.Length > 4 && rest[4] is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n' or (byte)'>' or (byte)'/';
    }

    private static bool SkipPast(ref ReadOnlySpan<byte> text, ReadOnlySpan<byte> terminator)
    {
        var end = text.IndexOf(terminator);
        if (end < 0) return false;
        text = text[(end + terminator.Length)..];
        return true;
    }
}
