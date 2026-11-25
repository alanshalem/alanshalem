using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPostContentUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ContentUpdatedAtUtc",
                table: "posts",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // Hasta acá la única fecha era UpdatedAtUtc, que también se mueve al publicar o programar. Cada cambio de
            // contenido ya deja una versión en el historial (AddPostRevisionsAndScheduling), así que la más nueva es la
            // fecha exacta del último cambio; sin historial, UpdatedAtUtc es la mejor aproximación. Mismo formato de
            // texto en las dos columnas: MAX compara bien.
            migrationBuilder.Sql("""
                UPDATE posts SET ContentUpdatedAtUtc = COALESCE(
                    (SELECT MAX(CreatedAtUtc) FROM post_revisions WHERE post_revisions.PostId = posts.Id),
                    UpdatedAtUtc);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DROP COLUMN nativo de SQLite, como en las migraciones anteriores: DropColumn reconstruiría la tabla posts.
            migrationBuilder.Sql("ALTER TABLE posts DROP COLUMN ContentUpdatedAtUtc;");
        }
    }
}
