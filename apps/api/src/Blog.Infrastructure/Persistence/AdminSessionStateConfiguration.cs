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

        // Fixed key and the row exists since the migration: reading and revoking are a SELECT and an UPDATE.
        builder.Property(state => state.Id).ValueGeneratedNever();
        builder.HasData(new AdminSessionState { Id = AdminSessionState.SingletonId, Epoch = 0 });
    }
}
