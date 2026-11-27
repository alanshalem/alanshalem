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
            // ----- Scheduled publishing: existing posts stay unscheduled (null) -----
            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledAtUtc",
                table: "posts",
                type: "TEXT",
                nullable: true);

            // ----- Version history -----
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

            // Each existing post starts its history with its current content as version 1 (dated at its last edit):
            // this way the first save after upgrading can already be undone. SQLite does not generate Guids, so the
            // post's Id is used, as in AddTranslations: it is unique (a single initial version per post) and already
            // has the format EF stores a Guid with. The tags are already the same JSON array.
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

            // Loses the history and the schedules (drafts stay drafts). SQLite's native DROP COLUMN, as in
            // AddTranslations: DropColumn would rebuild the posts table.
            migrationBuilder.Sql("ALTER TABLE posts DROP COLUMN ScheduledAtUtc;");
        }
    }
}
