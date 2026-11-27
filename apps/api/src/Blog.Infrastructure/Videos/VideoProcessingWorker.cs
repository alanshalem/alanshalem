using System.Threading.Channels;
using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Videos;

/// <summary>In-memory queue of videos to process.</summary>
internal sealed class ChannelVideoQueue : IVideoQueue
{
    // Unbounded: only the admin (one person) enqueues and each item is an id and a path. A single reader: the worker.
    private readonly Channel<VideoJob> _jobs = Channel.CreateUnbounded<VideoJob>(new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(VideoJob job) => _jobs.Writer.TryWrite(job);

    public IAsyncEnumerable<VideoJob> ReadAllAsync(CancellationToken cancellationToken) => _jobs.Reader.ReadAllAsync(cancellationToken);
}

/// <summary>
/// The only consumer of the queue: processes one video at a time (each in its own scope, with its DbContext). On start,
/// before accepting requests, it resolves the videos a restart left half done.
/// </summary>
internal sealed class VideoProcessingWorker(
    ChannelVideoQueue queue,
    IServiceScopeFactory scopes,
    ILogger<VideoProcessingWorker> logger) : BackgroundService
{
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using (var scope = scopes.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<VideoProcessor>().FailInterruptedAsync(cancellationToken);
        }

        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<VideoProcessor>().ProcessAsync(job, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                // The video is already marked as failed; here the details are logged and it goes on with the next one.
                logger.LogError(exception, "Processing of video {VideoId} failed.", job.VideoId);
            }
        }
    }
}
