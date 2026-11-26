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
            // El nombre del sitio y el crédito del hero son uno solo en los dos idiomas (L12, L13): salen las versiones en
            // inglés que sumó AddTranslations. DROP COLUMN nativo de SQLite (en vez de DropColumn, que reconstruye la tabla
            // con PRAGMA foreign_keys fuera de la transacción): todo el Up es una sola transacción, igual que en AddVideoEdit.
            migrationBuilder.Sql("ALTER TABLE site_settings DROP COLUMN NameEn;");
            migrationBuilder.Sql("ALTER TABLE hero_images DROP COLUMN CreditEn;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Vuelven vacías (null = el sitio en inglés usa el de español): el texto que tenían no se guardó.
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
