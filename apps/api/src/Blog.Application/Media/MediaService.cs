using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Media;

public sealed class MediaService(IMediaStorage storage)
{
    public const int MaxBytes = 8 * 1024 * 1024;

    /// <summary>Valida que el contenido sea realmente una imagen soportada y la guarda con un nombre generado por nosotros.</summary>
    public async Task<string> UploadImageAsync(Stream content, CancellationToken cancellationToken)
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

        var extension = ImageSniffer.DetectExtension(buffer.AsSpan(0, total))
            ?? throw new DomainException("Formato no soportado. Subí una imagen PNG, JPG, GIF, WebP o AVIF.");

        await using var bytes = new MemoryStream(buffer, 0, total, writable: false);
        return await storage.SaveAsync(bytes, extension, cancellationToken);
    }
}
