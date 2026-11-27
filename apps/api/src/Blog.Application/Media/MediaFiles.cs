using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Media;

/// <summary>
/// Whether the files of an asset are still on disk. The database and the media folder can drift apart (a database
/// restored without its folder, a lost volume), so before accepting an asset that already exists the disk is checked:
/// URLs pointing to missing files are never returned.
/// </summary>
internal static class MediaFiles
{
    public static bool HasAllFiles(this IMediaStorage storage, MediaAsset asset) =>
        asset.Variants.All(variant => storage.Exists(asset.RelativePathOf(variant)));

    /// <summary>A video has everything if each of its sources and its whole poster are there.</summary>
    public static bool HasAllFiles(this IMediaStorage storage, VideoAsset video) =>
        video.Poster is { } poster
        && storage.HasAllFiles(poster)
        && video.Sources.All(source => storage.Exists(video.RelativePathOf(source.Variant)));
}
