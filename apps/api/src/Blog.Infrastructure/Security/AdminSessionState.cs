namespace Blog.Infrastructure.Security;

/// <summary>
/// La única fila con la época de las sesiones del admin (tabla admin_session, sembrada por la migración). Tabla propia
/// y no una columna de otra fila única: los ajustes son datos del autor (y no existen hasta el primer guardado) y
/// site_build_state es el estado de la regeneración del sitio.
/// </summary>
internal sealed class AdminSessionState
{
    public const int SingletonId = 1;

    public int Id { get; set; }

    /// <summary>Sube en uno cada vez que se revocan todas las sesiones (<see cref="AdminSessionEpoch.RevokeAllAsync"/>).</summary>
    public int Epoch { get; set; }
}
