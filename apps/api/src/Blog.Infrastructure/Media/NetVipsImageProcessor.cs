using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;
using Microsoft.Extensions.Logging;
using NetVips;

namespace Blog.Infrastructure.Media;

/// <summary>
/// Image pipeline with libvips (NetVips). Processes one image at a time: encoding AVIF uses every core and quite a lot
/// of memory, and the API shares the VPS with other apps.
/// </summary>
internal sealed class NetVipsImageProcessor(ILogger<NetVipsImageProcessor> logger) : IImageProcessor, IImageFormatSupport
{
    // The buffer loader of each format ImageSniffer recognizes. Which ones exist depends on how the bundled libvips
    // (NetVips.Native) was built: probed in the API image, it has these and lacks HEVC (HEIC), JPEG XL, BMP and ICO.
    private static readonly Dictionary<string, string> Loaders = new(StringComparer.Ordinal)
    {
        ["png"] = "pngload_buffer",
        ["jpg"] = "jpegload_buffer",
        ["gif"] = "gifload_buffer",
        ["webp"] = "webpload_buffer",
        ["avif"] = "heifload_buffer",
        ["tif"] = "tiffload_buffer",
        ["svg"] = "svgload_buffer",
    };

    // Only these loaders read their pages as the frames of an animation. A multi-page TIFF is a stack of documents or
    // scans: only its first page is used, like a still image.
    private static readonly string[] AnimationLoaders = ["gifload_buffer", "webpload_buffer", "heifload_buffer"];
    private const string LoaderField = "vips-loader";

    // Quality calibrated for photos: to the naked eye the same as the original and much lighter than a JPEG.
    private const int AvifQuality = 50;
    private const int AvifEffort = 4; // 0-9: higher compresses barely more but takes several times longer
    private const int WebpQuality = 75;
    private const int WebpEffort = 6; // 0-6: the maximum; the cost is paid only once, on upload

    private const int PreviewSize = 64; // small base to compute the dominant color and the placeholder

    // From the sharpest to the tiniest: the first one that fits in MediaAsset.MaxPlaceholderLength is used. A 16 px one
    // almost always fits; the next ones cover very detailed images, and the last one (8 px, minimum quality) weighs a
    // few dozen bytes, so the upload never fails over the placeholder after encoding everything.
    private static readonly (int Size, int Quality)[] PlaceholderAttempts = [(16, 30), (16, 10), (12, 10), (8, 0)];

    // "Unlimited" height (VIPS_MAX_COORD): without it, thumbnail fits the image in a width × width square.
    private const int UnboundedHeight = 10_000_000;

    // Colors are grouped with 4 bits per channel (16 levels): the dominant one is the group with the most pixels.
    private const int ColorBucketShift = 4;
    private const int ColorLevels = 256 >> ColorBucketShift;

    private const string IccProfileField = "icc-profile-data";
    private const string PagesField = "n-pages";

    // Loader options. fail_on=truncated: a cut-off file fails to decode, instead of being published with the missing
    // part in gray. It has to go here: thumbnail's failOn parameter does not reach the loader.
    // n=-1: every frame of an animated GIF or WebP (by default only the first one is read).
    private const string LoadOptions = "fail_on=truncated";
    private const string AnimatedLoadOptions = LoadOptions + ",n=-1";

    private static readonly double[] White = [255, 255, 255];

    private readonly SemaphoreSlim _oneAtATime = new(1, 1);

    static NetVipsImageProcessor()
    {
        // libvips' operation cache helps when operations repeat; here every image is new and it would only take memory.
        Cache.Max = 0;
    }

    public bool CanDecode(string extension) =>
        Loaders.TryGetValue(extension, out var loader) && NetVips.NetVips.TypeFind("VipsOperation", loader) != 0;

    public ImageSize? ReadSize(byte[] image)
    {
        try
        {
            // NewFromBuffer and Autorot are lazy: only the header is read, no pixel.
            using var header = Image.NewFromBuffer(image);
            using var upright = header.Autorot();
            return new ImageSize(upright.Width, upright.Height, PagesOf(header));
        }
        catch (VipsException exception)
        {
            LogUnreadable(exception);
            return null;
        }
    }

    public async Task<ProcessedImage?> ProcessAsync(
        byte[] image, IReadOnlyList<MediaVariant> variants, CancellationToken cancellationToken)
    {
        await _oneAtATime.WaitAsync(cancellationToken);
        try
        {
            using var master = TryDecodeUpright(image, variants.Max(variant => variant.Width));
            return master is null ? null : EncodeAll(master, variants);
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    private static int PagesOf(Image header) =>
        header.GetTypeOf(PagesField) != 0 && AnimationLoaders.Contains((string)header.Get(LoaderField))
            ? (int)header.Get(PagesField)
            : 1;

    /// <summary>
    /// A single decode, at the largest width and with shrink-on-load; the other variants come from this copy in memory.
    /// thumbnail rotates by the EXIF and converts the embedded color profile to sRGB; Colourspace covers gray and 16 bits.
    /// An animation is read whole (a vertical strip of frames with "page-height") and thumbnail shrinks each frame.
    /// Only here are libvips errors caught: they are decoding errors (damaged file), not server errors; they are logged
    /// anyway, to tell a server failure (a missing loader, out of memory) from a broken file.
    /// </summary>
    private Image? TryDecodeUpright(byte[] original, int width)
    {
        try
        {
            using var header = Image.NewFromBuffer(original);
            using var thumbnail = Image.ThumbnailBuffer(
                original,
                width,
                optionString: PagesOf(header) > 1 ? AnimatedLoadOptions : LoadOptions,
                height: UnboundedHeight,
                size: Enums.Size.Down,
                outputProfile: "srgb");
            using var srgb = thumbnail.Colourspace(Enums.Interpretation.Srgb);
            // Already in sRGB, the profile is redundant; without it, the following resizes do not convert color again.
            using var withoutProfile = srgb.Mutate(image => image.Remove(IccProfileField));
            return withoutProfile.CopyMemory();
        }
        catch (VipsException exception)
        {
            LogUnreadable(exception);
            return null;
        }
    }

    private void LogUnreadable(VipsException exception) =>
        logger.LogWarning(exception, "libvips could not read the uploaded image; answering as a damaged file.");

    private static ProcessedImage EncodeAll(Image master, IReadOnlyList<MediaVariant> variants)
    {
        var files = variants.Select(variant => new EncodedVariant(variant, Encode(master, variant))).ToList();

        // The color and the placeholder come from the first frame (in an animation, master is the strip of all of them).
        using var firstFrame = master.Crop(0, 0, master.Width, master.PageHeight);
        using var thumbnail = firstFrame.ThumbnailImage(PreviewSize, height: PreviewSize);
        using var preview = thumbnail.HasAlpha() ? thumbnail.Flatten(background: White) : thumbnail.Copy();
        return new ProcessedImage(files, DominantColor(preview), Placeholder(preview));
    }

    // keep: None strips EXIF (GPS included), XMP, IPTC and the ICC profile: the browser assumes sRGB. It does not touch
    // the animation fields (page-height, delay, loop): WebP stores a strip with page-height as an animated WebP.
    private static byte[] Encode(Image master, MediaVariant variant)
    {
        using var resized = master.ThumbnailImage(variant.Width, height: UnboundedHeight, size: Enums.Size.Down);
        return variant.Format switch
        {
            MediaFormat.Avif => resized.HeifsaveBuffer(
                q: AvifQuality, effort: AvifEffort, compression: Enums.ForeignHeifCompression.Av1, keep: Enums.ForeignKeep.None),
            MediaFormat.Webp => resized.WebpsaveBuffer(
                q: WebpQuality, effort: WebpEffort, smartSubsample: true, keep: Enums.ForeignKeep.None),
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Format, "Unknown media format."),
        };
    }

    private static string DominantColor(Image preview)
    {
        var pixels = preview.WriteToMemory<byte>();
        var counts = new int[ColorLevels * ColorLevels * ColorLevels];
        var sums = new long[counts.Length, 3];

        for (var offset = 0; offset + 2 < pixels.Length; offset += preview.Bands)
        {
            int red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
            var bucket = ((((red >> ColorBucketShift) * ColorLevels) + (green >> ColorBucketShift)) * ColorLevels) + (blue >> ColorBucketShift);
            counts[bucket]++;
            sums[bucket, 0] += red;
            sums[bucket, 1] += green;
            sums[bucket, 2] += blue;
        }

        // Average within the winning group: the real color of that area, not the center of the group.
        var dominant = Array.IndexOf(counts, counts.Max());
        var count = counts[dominant];
        return $"#{sums[dominant, 0] / count:x2}{sums[dominant, 1] / count:x2}{sums[dominant, 2] / count:x2}";
    }

    private static string Placeholder(Image preview)
    {
        var placeholder = string.Empty;
        foreach (var (size, quality) in PlaceholderAttempts)
        {
            using var tiny = preview.ThumbnailImage(size, height: size);
            var webp = tiny.WebpsaveBuffer(q: quality, effort: WebpEffort, keep: Enums.ForeignKeep.None);
            placeholder = MediaAsset.PlaceholderPrefix + Convert.ToBase64String(webp);
            if (placeholder.Length <= MediaAsset.MaxPlaceholderLength)
            {
                break;
            }
        }

        return placeholder;
    }
}
