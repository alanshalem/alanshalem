using Blog.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Media;

public sealed class MediaOptions
{
    /// <summary>Carpeta donde se guardan las imágenes. En producción Caddy la sirve en /media; en Development, la API.</summary>
    public string Directory { get; set; } = "data/media";
}

internal sealed class DiskMediaStorage(IOptions<MediaOptions> options) : IMediaStorage
{
    public async Task SaveAsync(string relativePath, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        var fullPath = ResolveInsideRoot(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        // Se escribe a un temporal y se renombra: quien sirve /media nunca ve un archivo a medio escribir.
        var temporaryPath = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllBytesAsync(temporaryPath, content, cancellationToken);
        File.Move(temporaryPath, fullPath, overwrite: true);
    }

    // Segunda barrera (la primera es que el dominio arma las rutas): nada se escribe fuera de la carpeta de media.
    private string ResolveInsideRoot(string relativePath)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.Value.Directory));
        var fullPath = Path.GetFullPath(Path.Combine(root, relativePath));
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Ruta de media fuera de la carpeta permitida.");
        }

        return fullPath;
    }
}
