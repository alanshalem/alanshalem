using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// ¿La base responde? Es lo que mira el healthcheck del contenedor (GET /api/health/ready): un proceso vivo con la base
/// rota no sirve, y así se ve.
/// </summary>
public sealed class DatabaseReadiness(BlogDbContext db, ILogger<DatabaseReadiness> logger)
{
    /// <summary>
    /// Un SELECT 1 sobre una tabla real (site_build_state, con su fila sembrada por la migración) y no a secas: abrir
    /// una conexión a un archivo que falta crea una base vacía, y un SELECT 1 a secas ni lee el archivo.
    /// </summary>
    public async Task<bool> IsReadyAsync(CancellationToken cancellationToken)
    {
        try
        {
            // AnyAsync: SELECT EXISTS (SELECT 1 FROM site_build_state), sin el aviso de EF por un First sin orden.
            await db.SiteBuildStates.AnyAsync(cancellationToken);
            return true;
        }
        catch (DbException exception)
        {
            logger.LogWarning(exception, "La base de datos no responde.");
            return false;
        }
    }
}
