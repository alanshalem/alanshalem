using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Blog.Infrastructure.Persistence;

/// <summary>Detalles de SQLite que comparten todas las configuraciones y repositorios.</summary>
internal static class SqliteConventions
{
    // Código de error de SQLite para "violación de constraint" (índice único, NOT NULL, etc.).
    private const int ConstraintError = 19;

    // SQLite guarda DateTime como texto y al leerlo devuelve Kind=Unspecified; así lo marcamos siempre como UTC.
    public static readonly ValueConverter<DateTime, DateTime> UtcConverter =
        new(value => value, value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

    public static readonly ValueConverter<DateTime?, DateTime?> NullableUtcConverter =
        new(value => value, value => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : value);

    public static bool IsConstraintViolation(DbUpdateException exception) =>
        exception.InnerException is SqliteException { SqliteErrorCode: ConstraintError };
}
