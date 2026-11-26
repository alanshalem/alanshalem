using Blog.Infrastructure.Scheduling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Build;

/// <summary>
/// Reintenta la regeneración pendiente (<see cref="DurableSiteBuildTrigger"/>): al arrancar, la que dejó una ejecución
/// anterior, y después cada <see cref="Interval"/> mientras el builder no la acepte. Sin nada pendiente, solo lee una fila.
/// </summary>
internal sealed class SiteRebuildWorker(IServiceScopeFactory scopes, ILogger<SiteRebuildWorker> logger) : PeriodicWorker(logger)
{
    /// <summary>
    /// Un minuto: el sitio se pone al día poco después de que el builder vuelve, y un builder caído recibe un solo
    /// pedido por minuto.
    /// </summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override TimeSpan Period => Interval;

    protected override string Work => "el reintento de la regeneración del sitio";

    /// <summary>Una vuelta: a lo sumo un pedido al builder.</summary>
    internal async Task RetryPendingAsync(CancellationToken cancellationToken)
    {
        // Scope propio: el trigger usa el DbContext, que es por scope.
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DurableSiteBuildTrigger>().RetryPendingAsync(cancellationToken);
    }

    protected override Task RunOnceAsync(CancellationToken cancellationToken) => RetryPendingAsync(cancellationToken);
}
