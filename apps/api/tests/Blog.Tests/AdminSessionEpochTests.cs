using System.Data.Common;
using Blog.Application.Abstractions;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>
/// La época de las sesiones del admin, contra una base real: arranca en 0, revocar la sube y queda guardada (otra
/// instancia, como después de reiniciar la API, lee la nueva).
/// </summary>
public class AdminSessionEpochTests
{
    [Fact]
    public async Task The_epoch_starts_at_zero_and_revoking_raises_it_for_this_and_later_instances()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var epoch = database.Services.GetRequiredService<IAdminSessionEpoch>();

        Assert.Equal(0, await epoch.CurrentAsync(default));
        await epoch.RevokeAllAsync(default);
        await epoch.RevokeAllAsync(default);

        Assert.Equal(2, await epoch.CurrentAsync(default));
        var afterRestart = new AdminSessionEpoch(database.Services.GetRequiredService<IServiceScopeFactory>());
        Assert.Equal(2, await afterRestart.CurrentAsync(default));
    }

    [Fact]
    public async Task Concurrent_reads_never_see_an_older_epoch_once_revoked()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var epoch = database.Services.GetRequiredService<IAdminSessionEpoch>();

        var before = Enumerable.Range(0, 20).Select(_ => Task.Run(() => epoch.CurrentAsync(default).AsTask())).ToList();
        await epoch.RevokeAllAsync(default);
        var after = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => epoch.CurrentAsync(default).AsTask())));

        // Las lecturas que empezaron antes pueden ver 0 o 1; las que empiezan después de revocar, nunca la vieja.
        Assert.All(await Task.WhenAll(before), value => Assert.InRange(value, 0, 1));
        Assert.All(after, value => Assert.Equal(1, value));
    }

    [Fact]
    public async Task A_revocation_saved_in_the_database_is_enforced_even_if_refreshing_the_cache_fails()
    {
        var failNextEpochRead = new FailEpochReadAfterUpdate();
        await using var database = new SqliteTestDatabase(services =>
            services.ConfigureDbContext<BlogDbContext>(options => options.AddInterceptors(failNextEpochRead)));
        await database.InitializeAsync();
        var epoch = database.Services.GetRequiredService<IAdminSessionEpoch>();
        Assert.Equal(0, await epoch.CurrentAsync(default));

        failNextEpochRead.Armed = true;
        await Assert.ThrowsAnyAsync<Exception>(() => epoch.RevokeAllAsync(default));

        // La base ya quedó en 1: la memoria no puede seguir aceptando cookies de la época 0 (falla cerrado).
        Assert.Equal(1, await epoch.CurrentAsync(default));
    }

    /// <summary>Falla la primera lectura de la época que llega después del UPDATE que la revoca.</summary>
    private sealed class FailEpochReadAfterUpdate : DbCommandInterceptor
    {
        private bool _updateSeen;

        public bool Armed { get; set; }

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (Armed && command.CommandText.Contains("admin_session", StringComparison.Ordinal)) _updateSeen = true;
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Armed && _updateSeen && command.CommandText.Contains("admin_session", StringComparison.Ordinal))
            {
                Armed = false;
                throw new InvalidOperationException("Base ocupada (simulado)");
            }

            return ValueTask.FromResult(result);
        }
    }
}
