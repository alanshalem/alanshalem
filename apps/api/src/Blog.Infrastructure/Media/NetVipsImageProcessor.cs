using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.Extensions.Logging;
using NetVips;

namespace Blog.Infrastructure.Media;

/// <summary>
/// Pipeline de imágenes con libvips (NetVips). Procesa una imagen a la vez: codificar AVIF usa todos los núcleos y
/// bastante memoria, y la API comparte el VPS con otras apps.
/// </summary>
internal sealed class NetVipsImageProcessor(ILogger<NetVipsImageProcessor> logger) : IImageProcessor
{
    // Calidad calibrada para fotos: a simple vista igual al original y mucho más liviana que un JPEG.
    private const int AvifQuality = 50;
    private const int AvifEffort = 4; // 0-9: más alto comprime apenas más pero tarda varias veces más
    private const int WebpQuality = 75;
    private const int WebpEffort = 6; // 0-6: el máximo; el costo se paga una sola vez, al subir

    private const int PreviewSize = 64; // base chica para calcular el color dominante y el placeholder

    // Del más nítido al más diminuto: se usa el primero que entra en MediaAsset.MaxPlaceholderLength. Uno de 16 px
    // casi siempre entra; los siguientes cubren las imágenes con mucho detalle, y el último (8 px, calidad mínima)
    // pesa unas decenas de bytes, así que la subida nunca falla por el placeholder después de codificar todo.
    private static readonly (int Size, int Quality)[] PlaceholderAttempts = [(16, 30), (16, 10), (12, 10), (8, 0)];

    // Alto "sin límite" (VIPS_MAX_COORD): sin esto, thumbnail encaja la imagen en un cuadrado de ancho × ancho.
    private const int UnboundedHeight = 10_000_000;

    // Los colores se agrupan con 4 bits por canal (16 niveles): el dominante es el grupo con más píxeles.
    private const int ColorBucketShift = 4;
    private const int ColorLevels = 256 >> ColorBucketShift;

    private const string IccProfileField = "icc-profile-data";
    private const string PagesField = "n-pages";

    // Opciones del loader. fail_on=truncated: un archivo cortado falla al decodificar, en vez de publicarse con la
    // parte que falta en gris. Tiene que ir acá: el parámetro failOn de thumbnail no le llega al loader.
    // n=-1: todos los cuadros de un GIF o WebP animado (por defecto se lee solo el primero).
    private const string LoadOptions = "fail_on=truncated";
    private const string AnimatedLoadOptions = LoadOptions + ",n=-1";

    private static readonly double[] White = [255, 255, 255];

    private readonly SemaphoreSlim _oneAtATime = new(1, 1);

    static NetVipsImageProcessor()
    {
        // La caché de operaciones de libvips ayuda cuando se repiten; acá cada imagen es nueva y solo ocuparía memoria.
        Cache.Max = 0;
    }

    public ImageSize? ReadSize(byte[] image)
    {
        try
        {
            // NewFromBuffer y Autorot son perezosos: solo se lee la cabecera, ningún píxel.
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
        header.GetTypeOf(PagesField) != 0 ? (int)header.Get(PagesField) : 1;

    /// <summary>
    /// Una sola decodificación, al ancho mayor y con shrink-on-load; las demás variantes salen de esta copia en memoria.
    /// thumbnail rota según el EXIF y convierte el perfil de color embebido a sRGB; Colourspace cubre grises y 16 bits.
    /// Una animación se lee entera (tira vertical de cuadros con "page-height") y thumbnail achica cada cuadro.
    /// Solo acá se atrapan errores de libvips: son de decodificación (archivo dañado), no del servidor; igual se
    /// registran, para distinguir una falla del servidor (falta un loader, sin memoria) de un archivo roto.
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
            // Ya en sRGB, el perfil sobra; sin él, los redimensionados siguientes no vuelven a convertir color.
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
        logger.LogWarning(exception, "libvips no pudo leer la imagen subida; se responde como archivo dañado.");

    private static ProcessedImage EncodeAll(Image master, IReadOnlyList<MediaVariant> variants)
    {
        var files = variants.Select(variant => new EncodedVariant(variant, Encode(master, variant))).ToList();

        // El color y el placeholder salen del primer cuadro (en una animación, master es la tira de todos).
        using var firstFrame = master.Crop(0, 0, master.Width, master.PageHeight);
        using var thumbnail = firstFrame.ThumbnailImage(PreviewSize, height: PreviewSize);
        using var preview = thumbnail.HasAlpha() ? thumbnail.Flatten(background: White) : thumbnail.Copy();
        return new ProcessedImage(files, DominantColor(preview), Placeholder(preview));
    }

    // keep: None quita EXIF (incluido el GPS), XMP, IPTC y el perfil ICC: el navegador asume sRGB. No toca los
    // campos de animación (page-height, delay, loop): WebP guarda una tira con page-height como WebP animado.
    private static byte[] Encode(Image master, MediaVariant variant)
    {
        using var resized = master.ThumbnailImage(variant.Width, height: UnboundedHeight, size: Enums.Size.Down);
        return variant.Format switch
        {
            MediaFormat.Avif => resized.HeifsaveBuffer(
                q: AvifQuality, effort: AvifEffort, compression: Enums.ForeignHeifCompression.Av1, keep: Enums.ForeignKeep.None),
            MediaFormat.Webp => resized.WebpsaveBuffer(
                q: WebpQuality, effort: WebpEffort, smartSubsample: true, keep: Enums.ForeignKeep.None),
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Format, "Formato de media desconocido."),
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

        // Promedio dentro del grupo ganador: el color real de esa zona, no el centro del grupo.
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
