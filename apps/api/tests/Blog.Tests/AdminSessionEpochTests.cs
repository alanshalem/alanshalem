using Blog.Infrastructure.Security;
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
        var epoch = database.Services.GetRequiredService<AdminSessionEpoch>();

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
        var epoch = database.Services.GetRequiredService<AdminSessionEpoch>();

        var readers = Enumerable.Range(0, 20).Select(_ => Task.Run(() => epoch.CurrentAsync(default).AsTask())).ToList();
        await epoch.RevokeAllAsync(default);
        await Task.WhenAll(readers);

        Assert.Equal(1, await epoch.CurrentAsync(default));
    }
}
