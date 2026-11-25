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
            // ----- Posts: grupos de traducción y slug único por idioma -----
            migrationBuilder.DropIndex(
                name: "IX_posts_Slug",
                table: "posts");

            migrationBuilder.AddColumn<Guid>(
                name: "TranslationGroupId",
                table: "posts",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Cada post existente queda solo en su propio grupo. SQLite no genera Guids, así que se usa el Id del post: es
            // único y ya tiene el formato con que EF guarda un Guid. Va antes del índice único: con el valor por defecto
            // compartido, dos posts chocarían.
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

            // ----- Textos en inglés de ajustes y hero (null = el sitio usa los de español) -----
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
            // Pierde las versiones en otro idioma como tales (quedan como posts sueltos). Si dos comparten slug en
            // distinto idioma, el índice único de Slug no se puede recrear: hay que renombrar uno antes de volver atrás.
            // DROP COLUMN nativo de SQLite (en vez de DropColumn, que reconstruye la tabla con PRAGMA foreign_keys fuera
            // de la transacción), igual que en AddVideoEdit; los índices se quitan antes porque SQLite no borra una
            // columna indexada.
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
