using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>
/// Casos de uso de la galería del hero (fotos y videos). La galería se ve en la home, así que cada cambio pide
/// regenerar el sitio. Borrar un ítem no borra sus archivos: el mismo asset puede estar usado como portada o en un post.
/// </summary>
public sealed class HeroImageService(
    IHeroImageRepository heroImages,
    IMediaAssetRepository media,
    IVideoAssetRepository videos,
    IClock clock,
    ISiteBuildTrigger siteBuild)
{
    /// <summary>Todo lo de la galería, para el admin (incluido lo que el sitio todavía no puede mostrar).</summary>
    public async Task<IReadOnlyList<HeroImageDto>> ListAsync(CancellationToken cancellationToken) =>
        (await heroImages.ListAsync(cancellationToken)).Select(image => image.ToDto()).ToList();

    /// <summary>Lo que lee el builder: solo fotos y videos listos, así el sitio nunca apunta a un video sin archivos.</summary>
    public async Task<IReadOnlyList<HeroImageDto>> ListForSiteAsync(CancellationToken cancellationToken) =>
        (await heroImages.ListAsync(cancellationToken)).Where(image => image.IsPublishable).Select(image => image.ToDto()).ToList();

    public async Task<HeroImageDto> CreateAsync(CreateHeroImageRequest request, CancellationToken cancellationToken)
    {
        var content = HeroImageContent.Create(request.Alt, request.Credit);
        var image = (request.MediaId, request.VideoId) switch
        {
            ({ } mediaId, null) => HeroImage.CreatePhoto(
                await media.GetByIdAsync(mediaId, cancellationToken) ?? throw new DomainException("La imagen elegida no existe. Subila de nuevo."),
                content,
                clock.UtcNow),
            (null, { } videoId) => HeroImage.CreateVideo(
                await videos.GetByIdAsync(videoId, cancellationToken) ?? throw new DomainException("El video elegido no existe. Subilo de nuevo."),
                content,
                clock.UtcNow),
            _ => throw new DomainException("Elegí una foto o un video para el hero."),
        };

        heroImages.Add(image);
        await SaveAndRebuildAsync(cancellationToken);
        return image.ToDto();
    }

    public async Task<HeroImageDto> UpdateAsync(Guid id, UpdateHeroImageRequest request, CancellationToken cancellationToken)
    {
        // Se valida antes de leer o tocar nada: un pedido inválido no cambia lo guardado.
        var content = HeroImageContent.Create(request.Alt, request.Credit);
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
        await heroImages.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("La foto del hero no existe.");

    private async Task SaveAndRebuildAsync(CancellationToken cancellationToken)
    {
        await heroImages.SaveChangesAsync(cancellationToken);
        await siteBuild.RequestBuildAsync(cancellationToken);
    }
}
