using Blog.Domain;

namespace Blog.Application.Media;

public sealed record MediaVariantDto(MediaFormat Format, int Width, string Url);

/// <summary>
/// An uploaded image. <see cref="Url"/> is the widest WebP up to 1600 px (what whoever does not build a srcset uses);
/// <see cref="Variants"/> carries every file to build a &lt;picture&gt; with AVIF and WebP.
/// </summary>
public sealed record MediaAssetDto(
    Guid Id,
    string Url,
    int Width,
    int Height,
    string Color,
    string Placeholder,
    IReadOnlyList<MediaVariantDto> Variants,
    DateTime CreatedAt);

public static class MediaMapping
{
    public static MediaAssetDto ToDto(this MediaAsset asset) => new(
        asset.Id,
        asset.Url,
        asset.Width,
        asset.Height,
        asset.Color,
        asset.Placeholder,
        asset.Variants.Select(variant => new MediaVariantDto(variant.Format, variant.Width, asset.UrlOf(variant))).ToList(),
        asset.CreatedAtUtc);
}
