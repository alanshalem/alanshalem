using System.Data.Common;
using Blog.Application.Abstractions;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Build;

/// <summary>
/// El único camino para pedir una regeneración (publicar, ajustes, hero, publicación programada): primero deja la marca
/// "pendiente" en la base, después la manda, y la borra solo si el builder la aceptó. Si no la aceptó (error, timeout,
/// la API se apagaba), la marca queda y <see cref="SiteRebuildWorker"/> la reintenta, también después de reiniciar.
/// </summary>
internal sealed class DurableSiteBuildTrigger(
    BlogDbContext db,
    IBuildRequestSender sender,
    ILogger<DurableSiteBuildTrigger> logger) : ISiteBuildTrigger
{
    public async Task RequestBuildAsync(CancellationToken cancellationToken)
    {
        var requestId = Guid.CreateVersion7();
        await MarkPendingAsync(requestId);
        await SendAsync(requestId, cancellationToken);
    }

    /// <summary>
    /// Si hay una regeneración pendiente, la manda una vez: muchos pedidos fallidos son una sola marca, así que un
    /// builder caído recibe un pedido por reintento y no una ráfaga.
    /// </summary>
    public async Task RetryPendingAsync(CancellationToken cancellationToken)
    {
        var pending = await Singleton().Select(state => state.PendingRequestId).FirstOrDefaultAsync(cancellationToken);
        if (pending is { } requestId)
        {
            logger.LogInformation("Se reintenta la regeneración del sitio pendiente.");
            await SendAsync(requestId, cancellationToken);
        }
    }

    private IQueryable<SiteBuildState> Singleton() =>
        db.SiteBuildStates.Where(state => state.Id == SiteBuildState.SingletonId);

    // Sin el token del pedido a propósito: es una escritura corta y, si la API se está apagando, es justo la que no se
    // puede perder. Si la base falla acá, se registra y se manda igual (la regla del puerto: un rebuild no rompe el guardado).
    private async Task MarkPendingAsync(Guid requestId)
    {
        try
        {
            await Singleton().ExecuteUpdateAsync(set => set.SetProperty(state => state.PendingRequestId, requestId), CancellationToken.None);
        }
        catch (DbException exception)
        {
            logger.LogError(exception, "No se pudo marcar la regeneración como pendiente: si el builder no la acepta, no se reintenta.");
        }
    }

    private async Task SendAsync(Guid requestId, CancellationToken cancellationToken)
    {
        if (!await sender.SendAsync(cancellationToken))
        {
            logger.LogInformation("La regeneración del sitio queda pendiente; se reintenta en {Interval}.", SiteRebuildWorker.Interval);
            return;
        }

        try
        {
            // Solo la marca de este pedido: si mientras tanto llegó otro, el nuevo sigue pendiente hasta su propio OK.
            await Singleton()
                .Where(state => state.PendingRequestId == requestId)
                .ExecuteUpdateAsync(set => set.SetProperty(state => state.PendingRequestId, (Guid?)null), CancellationToken.None);
        }
        catch (DbException exception)
        {
            // La marca queda: a lo sumo se pide una regeneración de más, nunca una de menos.
            logger.LogWarning(exception, "El builder aceptó la regeneración pero no se pudo borrar la marca de pendiente.");
        }
    }
}
