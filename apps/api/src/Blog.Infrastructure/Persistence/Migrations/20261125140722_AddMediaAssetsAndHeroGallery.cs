using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaAssetsAndHeroGallery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The hero photo becomes a gallery (hero_images). SQLite's native DROP COLUMN (3.35+) is used instead of
            // DropColumn: EF would rebuild the table with PRAGMA foreign_keys outside the transaction, and an
            // interruption half way would leave the migration half applied. This way the whole Up is one transaction.
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN HeroImageAlt;");
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN HeroImageCredit;");
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN HeroImageUrl;");

            migrationBuilder.CreateTable(
                name: "media_assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Width = table.Column<int>(type: "INTEGER", nullable: false),
                    Height = table.Column<int>(type: "INTEGER", nullable: false),
                    Color = table.Column<string>(type: "TEXT", maxLength: 7, nullable: false),
                    Placeholder = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_assets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "hero_images",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Alt = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    Credit = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hero_images", x => x.Id);
                    table.ForeignKey(
                        name: "FK_hero_images_media_assets_MediaAssetId",
                        column: x => x.MediaAssetId,
                        principalTable: "media_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_hero_images_MediaAssetId",
                table: "hero_images",
                column: "MediaAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_Hash",
                table: "media_assets",
                column: "Hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "hero_images");

            migrationBuilder.DropTable(
                name: "media_assets");

            migrationBuilder.AddColumn<string>(
                name: "HeroImageAlt",
                table: "site_settings",
                type: "TEXT",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeroImageCredit",
                table: "site_settings",
                type: "TEXT",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeroImageUrl",
                table: "site_settings",
                type: "TEXT",
                maxLength: 2048,
                nullable: true);
        }
    }
}
