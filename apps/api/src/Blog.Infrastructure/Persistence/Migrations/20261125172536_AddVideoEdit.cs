using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddVideoEdit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Los videos ya procesados no tenían edición: se procesaron enteros y con corte directo, que es justo lo que
            // describen estos valores (el fin es su duración). Conservan su hash, así que sus archivos siguen valiendo.
            migrationBuilder.AddColumn<double>(
                name: "TrimStart",
                table: "video_assets",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "TrimEnd",
                table: "video_assets",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<string>(
                name: "Fade",
                table: "video_assets",
                type: "TEXT",
                maxLength: 10,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<double>(
                name: "FadeSeconds",
                table: "video_assets",
                type: "REAL",
                nullable: false,
                defaultValue: 1.0);

            migrationBuilder.Sql("UPDATE video_assets SET TrimEnd = DurationSeconds;");

            // La duración pasa a derivarse de la edición. DROP COLUMN nativo de SQLite (en vez de DropColumn, que EF
            // resuelve reconstruyendo la tabla con PRAGMA foreign_keys fuera de la transacción): todo el Up es una sola
            // transacción, igual que en AddHeroVideos.
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN DurationSeconds;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Vuelve a guardar la duración final (la que se perdería con la edición) y quita las columnas de edición.
            migrationBuilder.AddColumn<double>(
                name: "DurationSeconds",
                table: "video_assets",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.Sql(
                "UPDATE video_assets SET DurationSeconds = TrimEnd - TrimStart - CASE Fade WHEN 'Loop' THEN FadeSeconds ELSE 0 END;");
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN TrimStart;");
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN TrimEnd;");
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN Fade;");
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN FadeSeconds;");
        }
    }
}
