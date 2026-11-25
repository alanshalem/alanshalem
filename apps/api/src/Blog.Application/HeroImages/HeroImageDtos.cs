using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>Alta de una foto del hero a partir de una imagen ya subida (POST /api/admin/media). Crédito vacío = null.</summary>
public sealed record CreateHeroImageRequest(Guid MediaId, string? Alt, string? Credit);

public sealed record UpdateHeroImageRequest(string? Alt, string? Credit);

public sealed record HeroImageDto(Guid Id, MediaAssetDto Media, string Alt, string? Credit, DateTime CreatedAt);

public static class HeroImageMapping
{
    public static HeroImageDto ToDto(this HeroImage image) =>
        new(image.Id, image.Media.ToDto(), image.Alt, image.Credit, image.CreatedAtUtc);
}
