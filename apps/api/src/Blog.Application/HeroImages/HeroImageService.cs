using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.HeroImages;

/// <summary>
/// Casos de uso de la galería del hero. La galería se ve en la home, así que cada cambio pide regenerar el sitio.
/// Borrar una foto no borra sus archivos: el mismo asset puede estar usado como portada o dentro de un post.
/// </summary>
public sealed class HeroImageService(
    IHeroImageRepository heroImages,
    IMediaAssetRepository media,
    IClock clock,
    ISiteBuildTrigger siteBuild)
{
    public async Task<IReadOnlyList<HeroImageDto>> ListAsync(CancellationToken cancellationToken) =>
        (await heroImages.ListAsync(cancellationToken)).Select(image => image.ToDto()).ToList();

    public async Task<HeroImageDto> CreateAsync(CreateHeroImageRequest request, CancellationToken cancellationToken)
    {
        var content = HeroImageContent.Create(request.Alt, request.Credit);
        var asset = await media.GetByIdAsync(request.MediaId, cancellationToken)
            ?? throw new DomainException("La imagen elegida no existe. Subila de nuevo.");

        var image = HeroImage.Create(asset, content, clock.UtcNow);
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
