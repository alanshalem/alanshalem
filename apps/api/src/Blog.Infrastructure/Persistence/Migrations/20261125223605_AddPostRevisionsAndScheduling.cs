using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPostRevisionsAndScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ----- Publicación programada: los posts existentes quedan sin programar (null) -----
            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledAtUtc",
                table: "posts",
                type: "TEXT",
                nullable: true);

            // ----- Historial de versiones -----
            migrationBuilder.CreateTable(
                name: "post_revisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    PostId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Number = table.Column<int>(type: "INTEGER", nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Slug = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Summary = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false),
                    Body = table.Column<string>(type: "TEXT", nullable: false),
                    Tags = table.Column<string>(type: "TEXT", nullable: false),
                    CoverUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    CoverAlt = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_revisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_post_revisions_posts_PostId",
                        column: x => x.PostId,
                        principalTable: "posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_post_revisions_PostId_Number",
                table: "post_revisions",
                columns: new[] { "PostId", "Number" },
                unique: true);

            // Cada post existente arranca su historial con su contenido actual como versión 1 (fechada en su última
            // edición): así el primer guardado después de actualizar ya se puede deshacer. SQLite no genera Guids, así que
            // se usa el Id del post, como en AddTranslations: es único (una sola versión inicial por post) y ya tiene el
            // formato con que EF guarda un Guid. Las etiquetas ya son el mismo arreglo JSON.
            migrationBuilder.Sql("""
                INSERT INTO post_revisions (Id, PostId, Number, Title, Slug, Summary, Body, Tags, CoverUrl, CoverAlt, CreatedAtUtc)
                SELECT Id, Id, 1, Title, Slug, Summary, Body, Tags, CoverUrl, CoverAlt, UpdatedAtUtc FROM posts;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "post_revisions");

            // Pierde el historial y las programaciones (los borradores quedan como borradores). DROP COLUMN nativo de
            // SQLite, como en AddTranslations: DropColumn reconstruiría la tabla posts.
            migrationBuilder.Sql("ALTER TABLE posts DROP COLUMN ScheduledAtUtc;");
        }
    }
}
