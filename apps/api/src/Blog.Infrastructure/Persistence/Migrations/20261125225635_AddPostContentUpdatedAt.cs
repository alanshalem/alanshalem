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

            // Until now the only date was UpdatedAtUtc, which also moves on publishing or scheduling. Every content
            // change already leaves a version in the history (AddPostRevisionsAndScheduling), so the newest one is the
            // exact date of the last change; without history, UpdatedAtUtc is the best approximation. The same text
            // format in both columns: MAX compares correctly.
            migrationBuilder.Sql("""
                UPDATE posts SET ContentUpdatedAtUtc = COALESCE(
                    (SELECT MAX(CreatedAtUtc) FROM post_revisions WHERE post_revisions.PostId = posts.Id),
                    UpdatedAtUtc);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // SQLite's native DROP COLUMN, as in the previous migrations: DropColumn would rebuild the posts table.
            migrationBuilder.Sql("ALTER TABLE posts DROP COLUMN ContentUpdatedAtUtc;");
        }
    }
}
