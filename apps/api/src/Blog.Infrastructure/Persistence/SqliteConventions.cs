using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Blog.Infrastructure.Persistence;

/// <summary>SQLite details shared by every configuration and repository.</summary>
internal static class SqliteConventions
{
    // SQLite error code for "constraint violation" (unique index, NOT NULL, etc.).
    private const int ConstraintError = 19;

    // SQLite stores DateTime as text and reads it back with Kind=Unspecified; this way we always mark it as UTC.
    public static readonly ValueConverter<DateTime, DateTime> UtcConverter =
        new(value => value, value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

    public static readonly ValueConverter<DateTime?, DateTime?> NullableUtcConverter =
        new(value => value, value => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : value);

    public static bool IsConstraintViolation(DbUpdateException exception) =>
        exception.InnerException is SqliteException { SqliteErrorCode: ConstraintError };
}
