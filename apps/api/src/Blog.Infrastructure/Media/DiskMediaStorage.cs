using Blog.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Media;

public sealed class MediaOptions
{
    /// <summary>Folder where the images are stored. In production Caddy serves it at /media; in Development, the API.</summary>
    public string Directory { get; set; } = "data/media";
}

internal sealed class DiskMediaStorage(IOptions<MediaOptions> options) : IMediaStorage
{
    public async Task SaveAsync(string relativePath, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        var fullPath = ResolveInsideRoot(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        // Written to a temporary file and renamed: whoever serves /media never sees a half-written file.
        var temporaryPath = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllBytesAsync(temporaryPath, content, cancellationToken);
        File.Move(temporaryPath, fullPath, overwrite: true);
    }

    public bool Exists(string relativePath) => File.Exists(ResolveInsideRoot(relativePath));

    // Second barrier (the first is that the domain builds the paths): nothing is written outside the media folder.
    private string ResolveInsideRoot(string relativePath)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.Value.Directory));
        var fullPath = Path.GetFullPath(Path.Combine(root, relativePath));
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Media path outside the allowed folder.");
        }

        return fullPath;
    }
}
