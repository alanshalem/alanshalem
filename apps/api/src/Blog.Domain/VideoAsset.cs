using System.Security.Cryptography;
using System.Text;

namespace Blog.Domain;

public enum VideoStatus
{
    Processing,
    Ready,
    Failed,
}

/// <summary>
/// Un video subido para el hero, con su recorte y fundido (<see cref="Edit"/>). Se valida al subir (edición y regla
/// de tamaño) y se procesa en segundo plano: mientras tanto está en <see cref="VideoStatus.Processing"/>. Sus archivos
/// viven en /media/videos/{Hash}/{alto}.{códec}.mp4.
/// </summary>
public sealed class VideoAsset
{
    /// <summary>El error se le muestra al admin: alcanza con un mensaje corto.</summary>
    public const int MaxErrorLength = 500;

    public const string FolderName = "videos";

    // Constructor para EF Core.
    private VideoAsset()
    {
        Hash = string.Empty;
        Edit = null!;
        Sources = [];
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// Identidad del asset: <see cref="HashOf"/> del original y la edición. El mismo archivo con la misma edición es un
    /// solo asset; con otro recorte o fundido, otro. Los videos procesados antes de que hubiera edición conservan el
    /// hash del original (y así sus archivos en disco).
    /// </summary>
    public string Hash { get; private set; }

    /// <summary>Dimensiones como se ve (ya aplicada la rotación que guardan los teléfonos).</summary>
    public int Width { get; private set; }

    public int Height { get; private set; }

    public VideoEdit Edit { get; private set; }

    /// <summary>Lo que dura el video final (ya recortado y, en loop, sin el tramo que se funde con el principio).</summary>
    public double DurationSeconds => Edit.OutputSeconds;

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

    /// <param name="contentHash">SHA-256 del archivo original.</param>
    /// <exception cref="DomainException">Si no cumple la regla de tamaño del hero (la edición ya viene validada).</exception>
    public static VideoAsset Create(string contentHash, int width, int height, VideoEdit edit, DateTime nowUtc)
    {
        HeroFrame.Ensure(width, height);

        return new VideoAsset
        {
            Id = Guid.CreateVersion7(),
            Hash = HashOf(contentHash, edit),
            Width = width,
            Height = height,
            Edit = edit,
            Status = VideoStatus.Processing,
            CreatedAtUtc = nowUtc,
        };
    }

    /// <summary>
    /// SHA-256 del hash del original junto a la edición: sigue siendo un hash válido como carpeta, y cada edición del
    /// mismo archivo tiene la suya (sus archivos no se pisan). Es lo que se busca para no procesar dos veces lo mismo.
    /// </summary>
    public static string HashOf(string contentHash, VideoEdit edit)
    {
        ContentHash.EnsureValid(contentHash);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{contentHash}/{edit.Key}")));
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
