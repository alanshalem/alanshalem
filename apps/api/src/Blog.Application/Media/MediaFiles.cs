using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Media;

/// <summary>
/// Si los archivos de un asset siguen en disco. La base y la carpeta de media pueden separarse (una base restaurada sin
/// su carpeta, un volumen perdido), así que antes de dar por bueno un asset que ya existe se mira el disco: nunca se
/// devuelven URLs que apuntan a archivos que no están.
/// </summary>
internal static class MediaFiles
{
    public static bool HasAllFiles(this IMediaStorage storage, MediaAsset asset) =>
        asset.Variants.All(variant => storage.Exists(asset.RelativePathOf(variant)));

    /// <summary>Un video tiene todo si están cada una de sus fuentes y su póster entero.</summary>
    public static bool HasAllFiles(this IMediaStorage storage, VideoAsset video) =>
        video.Poster is { } poster
        && storage.HasAllFiles(poster)
        && video.Sources.All(source => storage.Exists(video.RelativePathOf(source.Variant)));
}
