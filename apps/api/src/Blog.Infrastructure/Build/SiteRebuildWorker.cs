using Blog.Infrastructure.Scheduling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Build;

/// <summary>
/// Retries the pending regeneration (<see cref="DurableSiteBuildTrigger"/>): on start, the one a previous run left,
/// and then every <see cref="Interval"/> while the builder does not accept it. With nothing pending, it only reads a row.
/// </summary>
internal sealed class SiteRebuildWorker(IServiceScopeFactory scopes, ILogger<SiteRebuildWorker> logger) : PeriodicWorker(logger)
{
    /// <summary>
    /// One minute: the site catches up shortly after the builder comes back, and a builder that is down gets a single
    /// request per minute.
    /// </summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override TimeSpan Period => Interval;

    protected override string Work => "pending site rebuild retry";

    /// <summary>One round: at most one request to the builder.</summary>
    internal async Task RetryPendingAsync(CancellationToken cancellationToken)
    {
        // A scope of its own: the trigger uses the DbContext, which is scoped.
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DurableSiteBuildTrigger>().RetryPendingAsync(cancellationToken);
    }

    protected override Task RunOnceAsync(CancellationToken cancellationToken) => RetryPendingAsync(cancellationToken);
}
