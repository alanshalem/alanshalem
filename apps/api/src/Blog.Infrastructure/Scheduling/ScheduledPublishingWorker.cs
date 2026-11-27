using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Scheduling;

/// <summary>
/// Publishes the scheduled drafts whose time has come. Checks as soon as it starts (catching up on what came due while
/// the API was down) and then every <see cref="Interval"/>. The time is decided by <see cref="IClock"/>; the timer only
/// marks when to look again.
/// </summary>
internal sealed class ScheduledPublishingWorker(IServiceScopeFactory scopes, ILogger<ScheduledPublishingWorker> logger)
    : PeriodicWorker(logger)
{
    /// <summary>A post goes out at most this long after its time: plenty for a blog, and the query on the posts is cheap.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override TimeSpan Period => Interval;

    protected override string Work => "scheduled posts check";

    /// <summary>
    /// One check: publishes each due post in its own scope (if one fails, it is logged and the others go on; it is
    /// retried on the next one) and, if any went out, requests a single rebuild: the builder regenerates the whole site
    /// anyway.
    /// </summary>
    /// <returns>How many were published.</returns>
    internal async Task<int> PublishDueAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<Guid> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            due = await scope.ServiceProvider.GetRequiredService<PostService>().ListDueAsync(cancellationToken);
        }

        var published = 0;
        try
        {
            foreach (var id in due)
            {
                try
                {
                    // A scope of its own: a DbContext left with a failed save does not drag the following posts along.
                    await using var scope = scopes.CreateAsyncScope();
                    if (await scope.ServiceProvider.GetRequiredService<PostService>().PublishIfDueAsync(id, cancellationToken))
                    {
                        published++;
                        logger.LogInformation("Published the scheduled post {PostId}.", id);
                    }
                }
                catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
                {
                    logger.LogError(exception, "Could not publish the scheduled post {PostId}; retrying on the next check.", id);
                }
            }
        }
        finally
        {
            // Also if the API shuts down half way through the batch: the ones already published leave their rebuild
            // pending (the trigger stores the mark even if the token is cancelled) and it is requested on the next start.
            if (published > 0)
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ISiteBuildTrigger>().RequestBuildAsync(cancellationToken);
            }
        }

        return published;
    }

    protected override Task RunOnceAsync(CancellationToken cancellationToken) => PublishDueAsync(cancellationToken);
}
