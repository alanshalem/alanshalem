using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Settings;

/// <summary>Casos de uso de los ajustes del sitio (datos del autor y enlaces).</summary>
public sealed class SiteSettingsService(ISiteSettingsRepository settings, ISiteBuildTrigger siteBuild)
{
    /// <summary>Lo guardado o, si todavía no se guardó nada, los valores por defecto (sin crear la fila).</summary>
    public async Task<SiteSettingsDto> GetAsync(CancellationToken cancellationToken) =>
        (await settings.GetAsync(cancellationToken))?.ToDto() ?? SiteSettingsContent.Default.ToDto();

    public async Task<SiteSettingsDto> SaveAsync(SaveSiteSettingsRequest request, CancellationToken cancellationToken)
    {
        // Se valida antes de leer o tocar nada: un pedido inválido no cambia lo guardado.
        var content = SiteSettingsContent.Create(
            request.Name,
            request.Tagline,
            request.Bio,
            request.Email,
            request.GithubUrl,
            request.LinkedinUrl,
            request.XUrl);

        var current = await settings.GetAsync(cancellationToken);
        if (current is null)
        {
            current = SiteSettings.Create(content);
            settings.Add(current);
        }
        else
        {
            current.Update(content);
        }

        await settings.SaveChangesAsync(cancellationToken);

        // Nombre, bio y enlaces aparecen en todas las páginas: siempre hay que regenerar el sitio.
        await siteBuild.RequestBuildAsync(cancellationToken);
        return current.ToDto();
    }
}
