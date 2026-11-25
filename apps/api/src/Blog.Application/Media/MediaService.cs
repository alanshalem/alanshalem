using System.Security.Cryptography;
using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Media;

/// <summary>
/// Subida de imágenes. Toda imagen (hero, portadas, imágenes de posts, pósters de video) pasa por el mismo pipeline:
/// se valida, se optimiza en AVIF y WebP en varios anchos y se guarda una sola vez por contenido.
/// </summary>
public sealed class MediaService(IImageProcessor images, IMediaStorage storage, IMediaAssetRepository assets, IClock clock)
{
    public const int MaxBytes = 8 * 1024 * 1024;

    /// <summary>
    /// 100 megapíxeles (contando todos los cuadros de una animación): sobra para cualquier cámara y frena archivos
    /// chicos que descomprimidos ocupan gigas.
    /// </summary>
    public const long MaxPixels = 100_000_000;

    private const string UnreadableMessage = "No se pudo leer la imagen: el archivo está dañado o incompleto.";

    public async Task<MediaAssetDto> UploadImageAsync(Stream content, CancellationToken cancellationToken) =>
        (await StoreImageAsync(content, cancellationToken)).ToDto();

    /// <summary>Todas las imágenes subidas: el builder las usa para armar el srcset de cualquier /media/... del sitio.</summary>
    public async Task<IReadOnlyList<MediaAssetDto>> ListAsync(CancellationToken cancellationToken) =>
        (await assets.ListAsync(cancellationToken)).Select(asset => asset.ToDto()).ToList();

    /// <summary>Lo mismo que <see cref="UploadImageAsync"/> pero devuelve la entidad: el póster de un video la referencia.</summary>
    internal async Task<MediaAsset> StoreImageAsync(Stream content, CancellationToken cancellationToken)
    {
        var original = await ReadWithinLimitAsync(content, cancellationToken);
        EnsureSupportedFormat(original);

        // Misma imagen = mismo hash = mismo asset: no se procesa ni se guarda dos veces. Solo se regeneran sus archivos
        // si faltan en disco (por ejemplo, una base restaurada sin su carpeta de media), así nunca se devuelven URLs muertas.
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));
        var existing = await assets.GetByHashAsync(hash, cancellationToken);
        if (existing is not null && storage.HasAllFiles(existing))
        {
            return existing;
        }

        var size = ReadSizeWithinLimit(original);
        var processed = await images.ProcessAsync(original, MediaVariant.For(size.Width, size.IsAnimated), cancellationToken)
            ?? throw new DomainException(UnreadableMessage);

        var asset = existing
            ?? MediaAsset.Create(hash, size.Width, size.Height, processed.Color, processed.Placeholder, clock.UtcNow, size.IsAnimated);

        // Primero los archivos y después la fila: un asset guardado nunca apunta a archivos que no existen.
        foreach (var file in processed.Files)
        {
            await storage.SaveAsync(asset.RelativePathOf(file.Variant), file.Content, cancellationToken);
        }

        if (existing is null)
        {
            assets.Add(asset);
            await assets.SaveChangesAsync(cancellationToken);
        }

        return asset;
    }

    private static async Task<byte[]> ReadWithinLimitAsync(Stream content, CancellationToken cancellationToken)
    {
        // Se lee como máximo MaxBytes + 1: alcanza para saber si se pasó, sin cargar archivos enormes en memoria.
        var buffer = new byte[MaxBytes + 1];
        var total = 0;
        int read;
        while ((read = await content.ReadAsync(buffer.AsMemory(total, buffer.Length - total), cancellationToken)) > 0)
        {
            total += read;
            if (total > MaxBytes)
            {
                throw new DomainException($"La imagen supera el máximo de {MaxBytes / (1024 * 1024)} MB.");
            }
        }

        return buffer.AsSpan(0, total).ToArray();
    }

    // Los magic bytes deciden antes que nada: así SVG (puede llevar scripts) ni siquiera llega al decodificador.
    private static void EnsureSupportedFormat(byte[] original)
    {
        if (ImageSniffer.DetectExtension(original) is null)
        {
            throw new DomainException("Formato no soportado. Subí una imagen PNG, JPG, GIF, WebP o AVIF.");
        }
    }

    private ImageSize ReadSizeWithinLimit(byte[] original)
    {
        var size = images.ReadSize(original) ?? throw new DomainException(UnreadableMessage);
        if (size.Pixels > MaxPixels)
        {
            throw new DomainException($"La imagen supera el máximo de {MaxPixels / 1_000_000} megapíxeles.");
        }

        return size;
    }
}
