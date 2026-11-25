using Blog.Application.Media;
using Blog.Application.Videos;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>
/// Alta de un ítem del hero: una foto ya subida (POST /api/admin/media) o un video ya listo
/// (POST /api/admin/media/videos). Va uno de los dos ids, no ambos. Crédito vacío = null.
/// </summary>
public sealed record CreateHeroImageRequest(Guid? MediaId, string? Alt, string? Credit, Guid? VideoId = null);

public sealed record UpdateHeroImageRequest(string? Alt, string? Credit);

/// <summary>Para un video, <see cref="Media"/> es su póster y <see cref="Video"/> trae sus fuentes; para una foto, Video es null.</summary>
public sealed record HeroImageDto(Guid Id, MediaAssetDto Media, string Alt, string? Credit, DateTime CreatedAt, VideoAssetDto? Video);

public static class HeroImageMapping
{
    public static HeroImageDto ToDto(this HeroImage image) =>
        new(image.Id, image.Media.ToDto(), image.Alt, image.Credit, image.CreatedAtUtc, image.Video?.ToDto());
}
