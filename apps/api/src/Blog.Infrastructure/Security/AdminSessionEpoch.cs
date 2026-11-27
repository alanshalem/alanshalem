using Blog.Application.Abstractions;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure.Security;

/// <summary>
/// The admin session epoch: a number stored in the database that each cookie carries from the moment the session
/// starts. Revoking raises it, and from then on no cookie issued before gets in, even if someone copied it (logging out
/// deletes the cookie from the browser, but does not make it invalid). Logout uses it; a password change must use it
/// too.
/// </summary>
/// <remarks>
/// It is checked on every request with a session, so it lives in memory and is read from the database only the first
/// time. Revoking updates the database and the memory together; if anything fails half way, the memory is left empty
/// and read again. That is enough because the API runs in a single process; with several instances, each one would
/// have to read the database again.
/// </remarks>
internal sealed class AdminSessionEpoch(IServiceScopeFactory scopes) : IAdminSessionEpoch
{
    // Not read yet, or a revocation failed half way: the next read goes to the database. Stored epochs start at 0.
    private const int Unknown = -1;

    // One change at a time: this way a slow database read cannot overwrite in memory an epoch already revoked.
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

    /// <summary>Invalidates every session issued so far.</summary>
    public async Task RevokeAllAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            // Fails closed: the epoch in memory is forgotten BEFORE raising it in the database. If the UPDATE is saved
            // but the re-read fails, the next check goes back to the database and no longer accepts the revoked cookies.
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
