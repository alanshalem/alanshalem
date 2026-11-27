using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Blog.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveNameEnAndCreditEn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The site name and the hero credit are proper names, one single field for both languages: the English
            // versions AddTranslations added go away. SQLite's native DROP COLUMN (instead of DropColumn, which
            // rebuilds the table with PRAGMA foreign_keys outside the transaction): the whole Up is one transaction,
            // as in AddVideoEdit.
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN NameEn;");
            migrationBuilder.Sql("ALTER TABLE hero_images DROP COLUMN CreditEn;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // They come back empty (null = the English site uses the Spanish one): the text they had was not kept.
            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "site_settings",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreditEn",
                table: "hero_images",
                type: "TEXT",
                maxLength: 200,
                nullable: true);
        }
    }
}
