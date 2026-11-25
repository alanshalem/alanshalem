using Blog.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Media;

public sealed class MediaOptions
{
    /// <summary>Carpeta donde se guardan las imágenes. Caddy la sirve directo en /media (la API solo escribe).</summary>
    public string Directory { get; set; } = "data/media";
}

internal sealed class DiskMediaStorage(IOptions<MediaOptions> options, IClock clock) : IMediaStorage
{
    public async Task<string> SaveAsync(Stream content, string extension, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        // El nombre lo generamos nosotros (nunca el que manda el usuario): no hay forma de escribir fuera de la carpeta.
        var relativePath = $"{now.Year:D4}/{now.Month:D2}/{Guid.NewGuid():N}.{extension}";

        var root = Path.GetFullPath(options.Value.Directory);
        var fullPath = Path.GetFullPath(Path.Combine(root, relativePath));
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Ruta de media fuera de la carpeta permitida.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await using var file = new FileStream(
            fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 81_920, useAsync: true);
        await content.CopyToAsync(file, cancellationToken);

        return $"/media/{relativePath}";
    }
}
