using System.Security.Cryptography;
using Blog.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Videos;

/// <summary>Originales de video en la carpeta de trabajo: se copian por partes, sin cargar 200 MB en memoria.</summary>
internal sealed class DiskVideoStaging(IOptions<VideoOptions> options) : IVideoStaging
{
    private const int CopyBufferSize = 1024 * 1024;
    private const string SourceExtension = ".source";

    public string Root => Path.GetFullPath(options.Value.WorkDirectory);

    public async Task<StagedVideo> SaveAsync(Stream content, long maxBytes, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Root);
        var path = Path.Combine(Root, Guid.NewGuid().ToString("N") + SourceExtension);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var head = new byte[StagedVideo.HeadLength];
        var buffer = new byte[CopyBufferSize];
        long total = 0;
        try
        {
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, CopyBufferSize, useAsync: true);
            int read;
            // Hasta maxBytes + 1: alcanza para que el caso de uso sepa que se pasó, sin copiar el resto.
            while (total <= maxBytes
                   && (read = await content.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, maxBytes + 1 - total)), cancellationToken)) > 0)
            {
                if (total < head.Length)
                {
                    buffer.AsSpan(0, (int)Math.Min(read, head.Length - total)).CopyTo(head.AsSpan((int)total));
                }

                hash.AppendData(buffer, 0, read);
                await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                total += read;
            }
        }
        catch
        {
            Delete(path);
            throw;
        }

        return new StagedVideo(path, Convert.ToHexStringLower(hash.GetHashAndReset()), total, head[..(int)Math.Min(total, head.Length)]);
    }

    public void Delete(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    public void Clear()
    {
        if (!Directory.Exists(Root))
        {
            return;
        }

        foreach (var directory in Directory.EnumerateDirectories(Root))
        {
            Directory.Delete(directory, recursive: true);
        }

        foreach (var file in Directory.EnumerateFiles(Root))
        {
            File.Delete(file);
        }
    }
}
