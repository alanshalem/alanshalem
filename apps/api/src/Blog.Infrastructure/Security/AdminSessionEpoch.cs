using Blog.Application.Abstractions;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure.Security;

/// <summary>
/// La época de las sesiones del admin: un número guardado en la base que cada cookie lleva desde que se inicia la
/// sesión. Revocar lo sube, y desde ese momento ninguna cookie emitida antes entra, aunque alguien la haya copiado
/// (cerrar sesión borra la cookie del navegador, pero no la vuelve inválida). Cerrar sesión lo usa; un cambio de
/// contraseña también tiene que usarlo.
/// </summary>
/// <remarks>
/// Se consulta en cada pedido con sesión, así que vive en memoria y solo se lee de la base la primera vez. Revocar
/// actualiza la base y la memoria juntas; si algo falla a mitad de camino, la memoria queda vacía y se relee. Alcanza porque la API corre en un único proceso; con varias instancias,
/// cada una tendría que volver a leer la base.
/// </remarks>
internal sealed class AdminSessionEpoch(IServiceScopeFactory scopes) : IAdminSessionEpoch
{
    // Not read yet, or a revocation failed half way: the next read goes to the database. Stored epochs start at 0.
    private const int Unknown = -1;

    // Un solo cambio a la vez: así una lectura lenta de la base no puede pisar en memoria una época ya revocada.
    private readonly SemaphoreSlim _gate = new(1, 1);

    // Written only while holding the gate; volatile so the lock-free read in CurrentAsync always sees the latest value.
    private volatile int _current = Unknown;

    public async ValueTask<int> CurrentAsync(CancellationToken cancellationToken)
    {
        var cached = _current;
        if (cached != Unknown)
        {
            return cached;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_current == Unknown)
            {
                await using var scope = scopes.CreateAsyncScope();
                _current = await ReadAsync(scope.ServiceProvider.GetRequiredService<BlogDbContext>(), cancellationToken);
            }

            return _current;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Invalida todas las sesiones emitidas hasta ahora.</summary>
    public async Task RevokeAllAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            // Falla cerrado: se olvida la época en memoria ANTES de subirla en la base. Si el UPDATE se guarda pero la
            // relectura falla, la próxima consulta vuelve a la base y ya no acepta las cookies revocadas.
            _current = Unknown;
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BlogDbContext>();
            await Singleton(db).ExecuteUpdateAsync(set => set.SetProperty(state => state.Epoch, state => state.Epoch + 1), cancellationToken);
            _current = await ReadAsync(db, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static Task<int> ReadAsync(BlogDbContext db, CancellationToken cancellationToken) =>
        Singleton(db).Select(state => state.Epoch).SingleAsync(cancellationToken);

    private static IQueryable<AdminSessionState> Singleton(BlogDbContext db) =>
        db.AdminSessionStates.Where(state => state.Id == AdminSessionState.SingletonId);
}
