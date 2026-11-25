using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "posts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Slug = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Summary = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false),
                    Body = table.Column<string>(type: "TEXT", nullable: false),
                    Tags = table.Column<string>(type: "TEXT", nullable: false),
                    CoverUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    CoverAlt = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    Lang = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    PublishedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_posts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "site_settings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Tagline = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    Bio = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    Email = table.Column<string>(type: "TEXT", maxLength: 254, nullable: true),
                    GithubUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    LinkedinUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    XUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    HeroImageUrl = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    HeroImageAlt = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    HeroImageCredit = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_site_settings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_posts_Slug",
                table: "posts",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_posts_Status",
                table: "posts",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "posts");

            migrationBuilder.DropTable(
                name: "site_settings");
        }
    }
}
