using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Scheduling;

/// <summary>
/// A background job that runs as soon as the API starts (catching up on what was left while it was down) and then
/// every <see cref="Period"/>. A failed round is logged and retried on the next one: if the exception escaped from
/// here, .NET would stop the whole API.
/// </summary>
internal abstract class PeriodicWorker(ILogger logger) : BackgroundService
{
    protected abstract TimeSpan Period { get; }

    /// <summary>What it does, for the log of a failed round (e.g. "scheduled posts check").</summary>
    protected abstract string Work { get; }

    protected abstract Task RunOnceAsync(CancellationToken cancellationToken);

    protected sealed override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Period);
        try
        {
            do
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    // For example, the database does not answer.
                    logger.LogError(exception, "Background work failed ({Work}); retrying in {Interval}.", Work, Period);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The API is shutting down.
        }
    }
}
