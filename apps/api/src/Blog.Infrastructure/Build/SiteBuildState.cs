namespace Blog.Infrastructure.Build;

/// <summary>
/// La única fila con el estado de la regeneración del sitio (tabla site_build_state, sembrada por la migración). Es una
/// tabla propia y no una columna de los ajustes: esa fila no existe hasta el primer guardado desde el admin, y esto
/// es estado de la infraestructura, no un dato del autor.
/// </summary>
internal sealed class SiteBuildState
{
    public const int SingletonId = 1;

    public int Id { get; set; }

    /// <summary>
    /// El último pedido de regeneración que el builder todavía no aceptó; null = nada pendiente. Cada pedido nuevo lo
    /// reemplaza, y solo el OK de ese mismo pedido lo borra: un OK de uno anterior no se lleva puesto uno más nuevo.
    /// </summary>
    public Guid? PendingRequestId { get; set; }
}
