using Blog.Application.Media;
using Blog.Application.Videos;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>
/// Adding a hero item: an already uploaded photo (POST /api/admin/media) or an already ready video
/// (POST /api/admin/media/videos). One of the two ids comes, not both. Empty credit = null. AltEn (English version)
/// is optional; the credit is one single field for both languages.
/// </summary>
public sealed record CreateHeroImageRequest(
    Guid? MediaId, string? Alt, string? Credit, Guid? VideoId = null, string? AltEn = null);

public sealed record UpdateHeroImageRequest(string? Alt, string? Credit, string? AltEn = null);

/// <summary>
/// For a video, <see cref="Media"/> is its poster and <see cref="Video"/> carries its sources; for a photo, Video is null.
/// AltEn null = the English site uses the Spanish one.
/// </summary>
public sealed record HeroImageDto(
    Guid Id, MediaAssetDto Media, string Alt, string? Credit, string? AltEn, DateTime CreatedAt, VideoAssetDto? Video);

public static class HeroImageMapping
{
    public static HeroImageDto ToDto(this HeroImage image) =>
        new(image.Id, image.Media.ToDto(), image.Alt, image.Credit, image.AltEn, image.CreatedAtUtc, image.Video?.ToDto());
}
