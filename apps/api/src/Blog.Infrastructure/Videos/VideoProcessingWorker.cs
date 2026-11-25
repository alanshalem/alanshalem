using System.Threading.Channels;
using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Videos;

/// <summary>Cola en memoria de videos por procesar.</summary>
internal sealed class ChannelVideoQueue : IVideoQueue
{
    // Sin límite: solo encola el admin (una persona) y cada ítem es un id y una ruta. Un solo lector: el worker.
    private readonly Channel<VideoJob> _jobs = Channel.CreateUnbounded<VideoJob>(new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(VideoJob job) => _jobs.Writer.TryWrite(job);

    public IAsyncEnumerable<VideoJob> ReadAllAsync(CancellationToken cancellationToken) => _jobs.Reader.ReadAllAsync(cancellationToken);
}

/// <summary>
/// Único consumidor de la cola: procesa un video a la vez (cada uno en su propio scope, con su DbContext). Al
/// arrancar, antes de aceptar pedidos, resuelve los videos que un reinicio dejó a medias.
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
                // El video ya quedó como fallido; acá se registran los detalles y se sigue con el próximo.
                logger.LogError(exception, "Falló el procesamiento del video {VideoId}.", job.VideoId);
            }
        }
    }
}
