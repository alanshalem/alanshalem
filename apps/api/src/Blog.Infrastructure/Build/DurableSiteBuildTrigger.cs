using System.Data.Common;
using Blog.Application.Abstractions;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Build;

/// <summary>
/// The only way to request a regeneration (publishing, settings, hero, scheduled publishing): first it leaves the
/// "pending" mark in the database, then it sends it, and it clears it only if the builder accepted it. If it did not
/// (error, timeout, the API was shutting down), the mark stays and <see cref="SiteRebuildWorker"/> retries it, also
/// after a restart.
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
    /// If there is a pending regeneration, sends it once: many failed requests are a single mark, so a builder that is
    /// down gets one request per retry and not a burst.
    /// </summary>
    public async Task RetryPendingAsync(CancellationToken cancellationToken)
    {
        var pending = await Singleton().Select(state => state.PendingRequestId).FirstOrDefaultAsync(cancellationToken);
        if (pending is { } requestId)
        {
            logger.LogInformation("Retrying the pending site rebuild.");
            await SendAsync(requestId, cancellationToken);
        }
    }

    private IQueryable<SiteBuildState> Singleton() =>
        db.SiteBuildStates.Where(state => state.Id == SiteBuildState.SingletonId);

    // Without the request's token on purpose: it is a short write and, if the API is shutting down, it is exactly the
    // one that must not be lost. If the database fails here, it is logged and sent anyway (the port's rule: a rebuild
    // does not break the save).
    private async Task MarkPendingAsync(Guid requestId)
    {
        try
        {
            await Singleton().ExecuteUpdateAsync(set => set.SetProperty(state => state.PendingRequestId, requestId), CancellationToken.None);
        }
        catch (DbException exception)
        {
            logger.LogError(exception, "Could not mark the site rebuild as pending: if the builder does not accept it, it is not retried.");
        }
    }

    private async Task SendAsync(Guid requestId, CancellationToken cancellationToken)
    {
        if (!await sender.SendAsync(cancellationToken))
        {
            logger.LogInformation("The site rebuild stays pending; retrying in {Interval}.", SiteRebuildWorker.Interval);
            return;
        }

        try
        {
            // Only this request's mark: if another one arrived meanwhile, the new one stays pending until its own OK.
            await Singleton()
                .Where(state => state.PendingRequestId == requestId)
                .ExecuteUpdateAsync(set => set.SetProperty(state => state.PendingRequestId, (Guid?)null), CancellationToken.None);
        }
        catch (DbException exception)
        {
            // The mark stays: at most one extra regeneration is requested, never one too few.
            logger.LogWarning(exception, "The builder accepted the site rebuild but the pending mark could not be cleared.");
        }
    }
}
