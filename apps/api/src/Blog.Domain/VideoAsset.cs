using System.Globalization;

namespace Blog.Domain;

public enum VideoStatus
{
    Processing,
    Ready,
    Failed,
}

/// <summary>
/// Un video subido para el hero. Se valida al subir (duración y regla de tamaño) y se procesa en segundo plano:
/// mientras tanto está en <see cref="VideoStatus.Processing"/>. Sus archivos viven en
/// /media/videos/{Hash}/{alto}.{códec}.mp4; el hash es el del original, así que el mismo video es un solo asset.
/// </summary>
public sealed class VideoAsset
{
    public const double MaxDurationSeconds = 15;

    /// <summary>El error se le muestra al admin: alcanza con un mensaje corto.</summary>
    public const int MaxErrorLength = 500;

    public const string FolderName = "videos";

    // Los contenedores redondean la duración: un clip de 15 s exportado por un teléfono suele medir 15,02 s.
    private const double DurationToleranceSeconds = 0.1;

    // Coma decimal como se escribe en español, sin depender de la cultura del servidor.
    private static readonly NumberFormatInfo SpanishNumbers = new() { NumberDecimalSeparator = "," };

    // Constructor para EF Core.
    private VideoAsset()
    {
        Hash = string.Empty;
        Sources = [];
    }

    public Guid Id { get; private set; }
    public string Hash { get; private set; }

    /// <summary>Dimensiones como se ve (ya aplicada la rotación que guardan los teléfonos).</summary>
    public int Width { get; private set; }

    public int Height { get; private set; }
    public double DurationSeconds { get; private set; }
    public VideoStatus Status { get; private set; }

    /// <summary>Por qué falló el proceso, en palabras para el admin. Null si no falló.</summary>
    public string? Error { get; private set; }

    public Guid? PosterId { get; private set; }

    /// <summary>Primer cuadro útil, optimizado por el pipeline de imágenes. Existe cuando el video está listo.</summary>
    public MediaAsset? Poster { get; private set; }

    public IReadOnlyList<VideoSource> Sources { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Avisos de la regla de tamaño (se derivan de las dimensiones: no se guardan).</summary>
    public IReadOnlyList<string> Warnings => HeroFrame.WarningsFor(Width, Height);

    /// <exception cref="DomainException">Si dura más de 15 s o no cumple la regla de tamaño del hero.</exception>
    public static VideoAsset Create(string hash, int width, int height, double durationSeconds, DateTime nowUtc)
    {
        ContentHash.EnsureValid(hash);
        if (durationSeconds > MaxDurationSeconds + DurationToleranceSeconds)
        {
            throw new DomainException(
                $"El video dura {durationSeconds.ToString("0.#", SpanishNumbers)} s y el máximo es {MaxDurationSeconds} s. Recortalo y volvé a subirlo.");
        }

        HeroFrame.Ensure(width, height);

        return new VideoAsset
        {
            Id = Guid.CreateVersion7(),
            Hash = hash,
            Width = width,
            Height = height,
            DurationSeconds = durationSeconds,
            Status = VideoStatus.Processing,
            CreatedAtUtc = nowUtc,
        };
    }

    public void MarkReady(MediaAsset poster, IReadOnlyList<VideoSource> sources)
    {
        EnsureStatus(VideoStatus.Processing);
        if (sources.Count == 0)
        {
            throw new ArgumentException("Un video listo tiene al menos una fuente.", nameof(sources));
        }

        Poster = poster;
        PosterId = poster.Id;
        Sources = [.. sources];
        Status = VideoStatus.Ready;
    }

    public void MarkFailed(string error)
    {
        EnsureStatus(VideoStatus.Processing);
        Error = error.Length > MaxErrorLength ? error[..MaxErrorLength] : error;
        Status = VideoStatus.Failed;
    }

    /// <summary>Volver a subir un video que falló lo procesa de nuevo (el mismo contenido es el mismo asset).</summary>
    public void Retry()
    {
        EnsureStatus(VideoStatus.Failed);
        Error = null;
        Status = VideoStatus.Processing;
    }

    /// <summary>Ruta del archivo dentro de la carpeta de media: videos/{hash}/{alto}.{códec}.mp4.</summary>
    public string RelativePathOf(VideoVariant variant) => $"{FolderName}/{Hash}/{variant.Height}.{variant.CodecName}.mp4";

    public string UrlOf(VideoVariant variant) => WebUrl.MediaPrefix + RelativePathOf(variant);

    // Las transiciones válidas son processing → ready | failed y failed → processing; otra es un error de programación.
    private void EnsureStatus(VideoStatus expected)
    {
        if (Status != expected)
        {
            throw new InvalidOperationException($"El video está en {Status} y se esperaba {expected}.");
        }
    }
}
