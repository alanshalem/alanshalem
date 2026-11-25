namespace Blog.Domain;

public enum MediaFormat
{
    Avif,
    Webp,
}

/// <summary>
/// Una versión optimizada de una imagen subida: formato y ancho en píxeles. Acá vive, una sola vez, qué anchos y
/// formatos se generan.
/// </summary>
public sealed record MediaVariant(MediaFormat Format, int Width)
{
    /// <summary>Anchos del srcset: de un móvil a una pantalla grande 2x, sin generar archivos que nadie pide.</summary>
    public static IReadOnlyList<int> StandardWidths { get; } = [640, 1024, 1600, 2400];

    /// <summary>AVIF primero: pesa menos, y el navegador usa el primer &lt;source&gt; que entiende. WebP es el respaldo.</summary>
    public static IReadOnlyList<MediaFormat> Formats { get; } = [MediaFormat.Avif, MediaFormat.Webp];

    /// <summary>
    /// Una animación sale solo en WebP: libheif no escribe AVIF animado y, como AVIF, quedaría reducida a su primer
    /// cuadro. WebP animado lo entienden todos los navegadores actuales.
    /// </summary>
    public static IReadOnlyList<MediaFormat> AnimatedFormats { get; } = [MediaFormat.Webp];

    public string Extension => Format switch
    {
        MediaFormat.Avif => "avif",
        MediaFormat.Webp => "webp",
        _ => throw new ArgumentOutOfRangeException(nameof(Format), Format, "Formato de media desconocido."),
    };

    /// <summary>
    /// Los anchos estándar que no superan el original (nunca se agranda una imagen). Si el original es más angosto
    /// que el menor de ellos, se genera una sola variante con su propio ancho.
    /// </summary>
    public static IReadOnlyList<int> WidthsFor(int originalWidth)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(originalWidth);

        var widths = StandardWidths.Where(width => width <= originalWidth).ToList();
        return widths.Count > 0 ? widths : [originalWidth];
    }

    /// <summary>Todas las variantes de una imagen de ese ancho: cada formato en cada ancho.</summary>
    public static IReadOnlyList<MediaVariant> For(int originalWidth, bool animated = false) =>
        [.. (animated ? AnimatedFormats : Formats)
            .SelectMany(format => WidthsFor(originalWidth).Select(width => new MediaVariant(format, width)))];
}
