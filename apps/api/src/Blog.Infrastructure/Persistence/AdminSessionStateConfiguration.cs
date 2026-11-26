using Blog.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class AdminSessionStateConfiguration : IEntityTypeConfiguration<AdminSessionState>
{
    public void Configure(EntityTypeBuilder<AdminSessionState> builder)
    {
        builder.ToTable("admin_session");
        builder.HasKey(state => state.Id);

        // Clave fija y la fila ya existe desde la migración: leer y revocar son un SELECT y un UPDATE.
        builder.Property(state => state.Id).ValueGeneratedNever();
        builder.HasData(new AdminSessionState { Id = AdminSessionState.SingletonId, Epoch = 0 });
    }
}
