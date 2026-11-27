using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTranslations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ----- Posts: translation groups and slug unique per language -----
            migrationBuilder.DropIndex(
                name: "IX_posts_Slug",
                table: "posts");

            migrationBuilder.AddColumn<Guid>(
                name: "TranslationGroupId",
                table: "posts",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Each existing post stays alone in its own group. SQLite does not generate Guids, so the post's Id is
            // used: it is unique and already has the format EF stores a Guid with. It goes before the unique index:
            // with the shared default value, two posts would collide.
            migrationBuilder.Sql("UPDATE posts SET TranslationGroupId = Id;");

            migrationBuilder.CreateIndex(
                name: "IX_posts_Lang_Slug",
                table: "posts",
                columns: new[] { "Lang", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_posts_TranslationGroupId_Lang",
                table: "posts",
                columns: new[] { "TranslationGroupId", "Lang" },
                unique: true);

            // ----- English texts of settings and hero (null = the site uses the Spanish ones) -----
            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "site_settings",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TaglineEn",
                table: "site_settings",
                type: "TEXT",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BioEn",
                table: "site_settings",
                type: "TEXT",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AltEn",
                table: "hero_images",
                type: "TEXT",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreditEn",
                table: "hero_images",
                type: "TEXT",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Loses the versions in another language as such (they stay as standalone posts). If two share a slug in
            // different languages, the unique Slug index cannot be recreated: one must be renamed before going back.
            // SQLite's native DROP COLUMN (instead of DropColumn, which rebuilds the table with PRAGMA foreign_keys
            // outside the transaction), as in AddVideoEdit; the indexes are dropped first because SQLite does not drop
            // an indexed column.
            migrationBuilder.DropIndex(
                name: "IX_posts_Lang_Slug",
                table: "posts");

            migrationBuilder.DropIndex(
                name: "IX_posts_TranslationGroupId_Lang",
                table: "posts");

            migrationBuilder.Sql("ALTER TABLE posts DROP COLUMN TranslationGroupId;");
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN NameEn;");
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN TaglineEn;");
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN BioEn;");
            migrationBuilder.Sql("ALTER TABLE hero_images DROP COLUMN AltEn;");
            migrationBuilder.Sql("ALTER TABLE hero_images DROP COLUMN CreditEn;");

            migrationBuilder.CreateIndex(
                name: "IX_posts_Slug",
                table: "posts",
                column: "Slug",
                unique: true);
        }
    }
}
