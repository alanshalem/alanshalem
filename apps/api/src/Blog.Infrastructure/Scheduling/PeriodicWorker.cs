using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Scheduling;

/// <summary>
/// Un trabajo en segundo plano que corre apenas arranca la API (pone al día lo que quedó de cuando estaba apagada) y
/// después cada <see cref="Period"/>. Una vuelta que falla se registra y se reintenta en la siguiente: si la excepción
/// saliera de acá, .NET detendría la API entera.
/// </summary>
internal abstract class PeriodicWorker(ILogger logger) : BackgroundService
{
    protected abstract TimeSpan Period { get; }

    /// <summary>Qué hace, para el log de una vuelta fallida (ej. "la revisión de posts programados").</summary>
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
                    // Por ejemplo, la base no responde.
                    logger.LogError(exception, "Falló {Work}; se reintenta en {Interval}.", Work, Period);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // La API se está apagando.
        }
    }
}
