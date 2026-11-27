using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddHeroVideos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsAnimated",
                table: "media_assets",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "video_assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Width = table.Column<int>(type: "INTEGER", nullable: false),
                    Height = table.Column<int>(type: "INTEGER", nullable: false),
                    DurationSeconds = table.Column<double>(type: "REAL", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Error = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    PosterId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Sources = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_video_assets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_video_assets_media_assets_PosterId",
                        column: x => x.PosterId,
                        principalTable: "media_assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // The new column with its foreign key in a single native SQLite ADD COLUMN (instead of AddColumn +
            // AddForeignKey): EF would rebuild hero_images with PRAGMA foreign_keys outside the transaction, and an
            // interruption half way would leave the migration half applied. This way the whole Up is one transaction.
            // Existing rows stay NULL: they are photos.
            migrationBuilder.Sql(
                "ALTER TABLE hero_images ADD COLUMN VideoAssetId TEXT NULL " +
                "CONSTRAINT FK_hero_images_video_assets_VideoAssetId REFERENCES video_assets (Id) ON DELETE RESTRICT;");

            migrationBuilder.CreateIndex(
                name: "IX_hero_images_VideoAssetId",
                table: "hero_images",
                column: "VideoAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_video_assets_Hash",
                table: "video_assets",
                column: "Hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_video_assets_PosterId",
                table: "video_assets",
                column: "PosterId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_hero_images_video_assets_VideoAssetId",
                table: "hero_images");

            migrationBuilder.DropTable(
                name: "video_assets");

            migrationBuilder.DropIndex(
                name: "IX_hero_images_VideoAssetId",
                table: "hero_images");

            migrationBuilder.DropColumn(
                name: "IsAnimated",
                table: "media_assets");

            migrationBuilder.DropColumn(
                name: "VideoAssetId",
                table: "hero_images");
        }
    }
}
