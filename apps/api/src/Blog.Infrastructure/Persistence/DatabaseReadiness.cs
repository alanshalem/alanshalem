using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// Does the database answer? It is what the container healthcheck looks at (GET /api/health/ready): a live process with
/// a broken database is useless, and this way it shows.
/// </summary>
public sealed class DatabaseReadiness(BlogDbContext db, ILogger<DatabaseReadiness> logger)
{
    /// <summary>
    /// A SELECT 1 on a real table (site_build_state, with its row seeded by the migration) and not a bare one: opening a
    /// connection to a missing file creates an empty database, and a bare SELECT 1 does not even read the file.
    /// </summary>
    public async Task<bool> IsReadyAsync(CancellationToken cancellationToken)
    {
        try
        {
            // AnyAsync: SELECT EXISTS (SELECT 1 FROM site_build_state), without EF's warning about a First without order.
            await db.SiteBuildStates.AnyAsync(cancellationToken);
            return true;
        }
        catch (DbException exception)
        {
            logger.LogWarning(exception, "The database does not answer.");
            return false;
        }
    }
}
