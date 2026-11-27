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
            // Videos already processed had no edit: they were processed whole and with a hard cut, which is exactly
            // what these values describe (the end is their duration). They keep their hash, so their files stay valid.
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

            // The duration becomes derived from the edit. SQLite's native DROP COLUMN (instead of DropColumn, which EF
            // handles by rebuilding the table with PRAGMA foreign_keys outside the transaction): the whole Up is one
            // transaction, as in AddHeroVideos.
            migrationBuilder.Sql("ALTER TABLE video_assets DROP COLUMN DurationSeconds;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Stores the final duration again (the one that would be lost with the edit) and drops the edit columns.
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
