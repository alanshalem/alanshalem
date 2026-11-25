using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>
/// Una imagen subida, ya optimizada. Sus archivos viven en /media/{Hash}/{ancho}.{avif|webp}; el hash es el del
/// archivo original, así que volver a subir la misma imagen reutiliza este asset en vez de duplicarlo.
/// </summary>
public sealed partial class MediaAsset
{
    /// <summary>SHA-256 en hexadecimal.</summary>
    public const int HashLength = 64;

    public const int ColorLength = 7;

    /// <summary>El placeholder va embebido en el HTML de cada página que muestra la imagen: tiene que ser diminuto.</summary>
    public const int MaxPlaceholderLength = 400;

    /// <summary>La URL principal (para quien no arma srcset) es el WebP más ancho hasta este tamaño.</summary>
    public const int MaxDefaultWidth = 1600;

    public const string PlaceholderPrefix = "data:image/webp;base64,";

    // Constructor para EF Core.
    private MediaAsset()
    {
        Hash = Color = Placeholder = string.Empty;
    }

    public Guid Id { get; private set; }
    public string Hash { get; private set; }

    /// <summary>Dimensiones del original ya rotado según su EXIF (como se ve, no como se guardó).</summary>
    public int Width { get; private set; }

    public int Height { get; private set; }

    /// <summary>Color dominante, #rrggbb: fondo mientras carga la imagen.</summary>
    public string Color { get; private set; }

    /// <summary>WebP de ~16 px en data URI: vista borrosa instantánea mientras carga la imagen.</summary>
    public string Placeholder { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public IReadOnlyList<MediaVariant> Variants => MediaVariant.For(Width);

    public string Url => UrlOf(Variants.Last(variant => variant.Format == MediaFormat.Webp && variant.Width <= MaxDefaultWidth));

    // Se generan en el servidor, nunca los escribe el usuario: un valor inválido es un error de programación.
    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex HashPattern();

    [GeneratedRegex("^#[0-9a-f]{6}$")]
    private static partial Regex ColorPattern();

    public static MediaAsset Create(string hash, int width, int height, string color, string placeholder, DateTime nowUtc)
    {
        // El hash termina siendo una carpeta en disco: validarlo garantiza que no se escribe fuera de /media.
        if (!HashPattern().IsMatch(hash))
        {
            throw new ArgumentException("El hash debe ser un SHA-256 en hexadecimal en minúsculas.", nameof(hash));
        }

        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);

        if (!ColorPattern().IsMatch(color))
        {
            throw new ArgumentException("El color debe tener el formato #rrggbb.", nameof(color));
        }

        if (!placeholder.StartsWith(PlaceholderPrefix, StringComparison.Ordinal) || placeholder.Length > MaxPlaceholderLength)
        {
            throw new ArgumentException($"El placeholder debe ser un data URI WebP de hasta {MaxPlaceholderLength} caracteres.", nameof(placeholder));
        }

        return new MediaAsset
        {
            Id = Guid.CreateVersion7(),
            Hash = hash,
            Width = width,
            Height = height,
            Color = color,
            Placeholder = placeholder,
            CreatedAtUtc = nowUtc,
        };
    }

    /// <summary>Ruta del archivo dentro de la carpeta de media: {hash}/{ancho}.{extensión}.</summary>
    public string RelativePathOf(MediaVariant variant) => $"{Hash}/{variant.Width}.{variant.Extension}";

    public string UrlOf(MediaVariant variant) => WebUrl.MediaPrefix + RelativePathOf(variant);
}
