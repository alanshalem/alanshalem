using System.Security.Cryptography;
using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Media;

/// <summary>
/// Image upload. Every image (hero, covers, post images, video posters) goes through the same pipeline: it is
/// validated, optimized into AVIF and WebP at several widths and stored once per content.
/// </summary>
public sealed class MediaService(IImageProcessor images, IMediaStorage storage, IMediaAssetRepository assets, IClock clock)
{
    public const int MaxBytes = 8 * 1024 * 1024;

    /// <summary>
    /// 100 megapixels (counting every frame of an animation): more than enough for any camera, and it stops small
    /// files that take gigabytes once decompressed.
    /// </summary>
    public const long MaxPixels = 100_000_000;

    public async Task<MediaAssetDto> UploadImageAsync(Stream content, CancellationToken cancellationToken) =>
        (await StoreImageAsync(content, cancellationToken)).ToDto();

    /// <summary>Every uploaded image: the builder uses them to build the srcset of any /media/... on the site.</summary>
    public async Task<IReadOnlyList<MediaAssetDto>> ListAsync(CancellationToken cancellationToken) =>
        (await assets.ListAsync(cancellationToken)).Select(asset => asset.ToDto()).ToList();

    /// <summary>The same as <see cref="UploadImageAsync"/> but returns the entity: a video's poster references it.</summary>
    internal async Task<MediaAsset> StoreImageAsync(Stream content, CancellationToken cancellationToken)
    {
        var original = await ReadWithinLimitAsync(content, cancellationToken);
        EnsureDecodableFormat(original);

        // Same image = same hash = same asset: it is not processed or stored twice. Its files are only regenerated if
        // missing on disk (for example, a database restored without its media folder), so dead URLs are never returned.
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));
        var existing = await assets.GetByHashAsync(hash, cancellationToken);
        if (existing is not null && storage.HasAllFiles(existing))
        {
            return existing;
        }

        var size = ReadSizeWithinLimit(original);
        var processed = await images.ProcessAsync(original, MediaVariant.For(size.Width, size.IsAnimated), cancellationToken)
            ?? throw new DomainException(MessageKeys.MediaUnreadable);

        var asset = existing
            ?? MediaAsset.Create(hash, size.Width, size.Height, processed.Color, processed.Placeholder, clock.UtcNow, size.IsAnimated);

        // Files first and the row afterwards: a stored asset never points to files that do not exist.
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
        // At most MaxBytes + 1 is read: enough to know whether it went over, without loading huge files in memory.
        var buffer = new byte[MaxBytes + 1];
        var total = 0;
        int read;
        while ((read = await content.ReadAsync(buffer.AsMemory(total, buffer.Length - total), cancellationToken)) > 0)
        {
            total += read;
            if (total > MaxBytes)
            {
                throw new DomainException(MessageKeys.MediaTooLarge, ("max", MaxBytes / (1024 * 1024)));
            }
        }

        return buffer.AsSpan(0, total).ToArray();
    }

    // Magic bytes decide before anything else: only recognized images reach the decoder, and a format it cannot read
    // (an iPhone's HEIC, a BMP, or SVG on a libvips without its rasterizer) is named instead of being called damaged.
    private void EnsureDecodableFormat(byte[] original)
    {
        var extension = ImageSniffer.DetectExtension(original);
        if (extension is null)
        {
            throw ImageSniffer.UndecodableFormatName(original) is { } name
                ? new DomainException(MessageKeys.MediaFormatNotDecodable, ("format", name))
                : new DomainException(MessageKeys.MediaUnsupportedFormat);
        }

        if (images is IImageFormatSupport formats && !formats.CanDecode(extension))
        {
            throw new DomainException(MessageKeys.MediaFormatNotDecodable, ("format", DisplayName(extension)));
        }
    }

    private static string DisplayName(string extension) => extension switch
    {
        "jpg" => "JPEG",
        "tif" => "TIFF",
        _ => extension.ToUpperInvariant(),
    };

    private ImageSize ReadSizeWithinLimit(byte[] original)
    {
        var size = images.ReadSize(original) ?? throw new DomainException(MessageKeys.MediaUnreadable);
        if (size.Pixels > MaxPixels)
        {
            throw new DomainException(MessageKeys.MediaTooManyPixels, ("max", MaxPixels / 1_000_000));
        }

        return size;
    }
}
