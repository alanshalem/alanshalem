namespace Blog.Domain;

public enum MediaFormat
{
    Avif,
    Webp,
}

/// <summary>
/// An optimized version of an uploaded image: format and width in pixels. Which widths and formats are generated lives
/// here, once.
/// </summary>
public sealed record MediaVariant(MediaFormat Format, int Width)
{
    /// <summary>srcset widths: from a phone to a large 2x screen, without generating files nobody requests.</summary>
    public static IReadOnlyList<int> StandardWidths { get; } = [640, 1024, 1600, 2400];

    /// <summary>AVIF first: it is lighter, and the browser uses the first &lt;source&gt; it understands. WebP is the fallback.</summary>
    public static IReadOnlyList<MediaFormat> Formats { get; } = [MediaFormat.Avif, MediaFormat.Webp];

    /// <summary>
    /// An animation is produced only as WebP: libheif does not write animated AVIF and, as AVIF, it would be reduced to
    /// its first frame. Every current browser understands animated WebP.
    /// </summary>
    public static IReadOnlyList<MediaFormat> AnimatedFormats { get; } = [MediaFormat.Webp];

    public string Extension => Format switch
    {
        MediaFormat.Avif => "avif",
        MediaFormat.Webp => "webp",
        _ => throw new ArgumentOutOfRangeException(nameof(Format), Format, "Unknown media format."),
    };

    /// <summary>
    /// The standard widths that do not exceed the original (an image is never enlarged). If the original is narrower
    /// than the smallest of them, a single variant with its own width is generated.
    /// </summary>
    public static IReadOnlyList<int> WidthsFor(int originalWidth)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(originalWidth);

        var widths = StandardWidths.Where(width => width <= originalWidth).ToList();
        return widths.Count > 0 ? widths : [originalWidth];
    }

    /// <summary>All the variants of an image of that width: each format at each width.</summary>
    public static IReadOnlyList<MediaVariant> For(int originalWidth, bool animated = false) =>
        [.. (animated ? AnimatedFormats : Formats)
            .SelectMany(format => WidthsFor(originalWidth).Select(width => new MediaVariant(format, width)))];
}
