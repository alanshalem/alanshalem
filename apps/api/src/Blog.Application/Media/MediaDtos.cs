using Blog.Domain;

namespace Blog.Application.Media;

public sealed record MediaVariantDto(MediaFormat Format, int Width, string Url);

/// <summary>
/// Una imagen subida. <see cref="Url"/> es el WebP más ancho hasta 1600 px (lo que usa quien no arma srcset);
/// <see cref="Variants"/> trae todos los archivos para armar &lt;picture&gt; con AVIF y WebP.
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
