using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>
/// Use cases of the hero gallery (photos and videos). The gallery shows on the home page, so every change asks to
/// regenerate the site. Deleting an item does not delete its files: the same asset may be used as a cover or in a post.
/// </summary>
public sealed class HeroImageService(
    IHeroImageRepository heroImages,
    IMediaAssetRepository media,
    IVideoAssetRepository videos,
    IClock clock,
    ISiteBuildTrigger siteBuild)
{
    /// <summary>Everything in the gallery, for the admin (including what the site cannot show yet).</summary>
    public async Task<IReadOnlyList<HeroImageDto>> ListAsync(CancellationToken cancellationToken) =>
        (await heroImages.ListAsync(cancellationToken)).Select(image => image.ToDto()).ToList();

    /// <summary>What the builder reads: only photos and ready videos, so the site never points to a video without files.</summary>
    public async Task<IReadOnlyList<HeroImageDto>> ListForSiteAsync(CancellationToken cancellationToken) =>
        (await heroImages.ListAsync(cancellationToken)).Where(image => image.IsPublishable).Select(image => image.ToDto()).ToList();

    public async Task<HeroImageDto> CreateAsync(CreateHeroImageRequest request, CancellationToken cancellationToken)
    {
        var content = HeroImageContent.Create(request.Alt, request.Credit, request.AltEn);
        var image = (request.MediaId, request.VideoId) switch
        {
            ({ } mediaId, null) => HeroImage.CreatePhoto(
                await media.GetByIdAsync(mediaId, cancellationToken) ?? throw new DomainException(MessageKeys.HeroImageNotFound),
                content,
                clock.UtcNow),
            (null, { } videoId) => HeroImage.CreateVideo(
                await videos.GetByIdAsync(videoId, cancellationToken) ?? throw new DomainException(MessageKeys.HeroVideoNotFound),
                content,
                clock.UtcNow),
            _ => throw new DomainException(MessageKeys.HeroSourceRequired),
        };

        heroImages.Add(image);
        await SaveAndRebuildAsync(cancellationToken);
        return image.ToDto();
    }

    public async Task<HeroImageDto> UpdateAsync(Guid id, UpdateHeroImageRequest request, CancellationToken cancellationToken)
    {
        // Validated before reading or touching anything: an invalid request does not change what is stored.
        var content = HeroImageContent.Create(request.Alt, request.Credit, request.AltEn);
        var image = await FindAsync(id, cancellationToken);

        image.Update(content);
        await SaveAndRebuildAsync(cancellationToken);
        return image.ToDto();
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var image = await FindAsync(id, cancellationToken);
        heroImages.Remove(image);
        await SaveAndRebuildAsync(cancellationToken);
    }

    private async Task<HeroImage> FindAsync(Guid id, CancellationToken cancellationToken) =>
        await heroImages.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(MessageKeys.HeroItemNotFound);

    private async Task SaveAndRebuildAsync(CancellationToken cancellationToken)
    {
        await heroImages.SaveChangesAsync(cancellationToken);
        await siteBuild.RequestBuildAsync(cancellationToken);
    }
}
