using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Scheduling;

/// <summary>
/// Publica los borradores programados cuya hora llegó. Revisa apenas arranca (pone al día lo que venció con la API
/// apagada) y después cada <see cref="Interval"/>. La hora la decide <see cref="IClock"/>; el temporizador solo marca
/// cuándo volver a mirar.
/// </summary>
internal sealed class ScheduledPublishingWorker(IServiceScopeFactory scopes, ILogger<ScheduledPublishingWorker> logger)
    : PeriodicWorker(logger)
{
    /// <summary>Un post sale a lo sumo esto después de su hora: sobra para un blog, y la consulta sobre los posts es barata.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override TimeSpan Period => Interval;

    protected override string Work => "la revisión de posts programados";

    /// <summary>
    /// Una revisión: publica cada vencido en su propio scope (si uno falla, se registra y se sigue con los demás; se
    /// reintenta en la próxima) y, si salió alguno, pide un solo rebuild: el builder regenera el sitio entero igual.
    /// </summary>
    /// <returns>Cuántos se publicaron.</returns>
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
                    // Scope propio: un DbContext que quedó con un guardado fallido no arrastra a los posts siguientes.
                    await using var scope = scopes.CreateAsyncScope();
                    if (await scope.ServiceProvider.GetRequiredService<PostService>().PublishIfDueAsync(id, cancellationToken))
                    {
                        published++;
                        logger.LogInformation("Se publicó el post programado {PostId}.", id);
                    }
                }
                catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
                {
                    logger.LogError(exception, "No se pudo publicar el post programado {PostId}; se reintenta en la próxima revisión.", id);
                }
            }
        }
        finally
        {
            // También si la API se apaga a mitad de la tanda: los ya publicados dejan su rebuild pendiente (el trigger
            // guarda la marca aunque el token esté cancelado) y se pide al volver a arrancar.
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
