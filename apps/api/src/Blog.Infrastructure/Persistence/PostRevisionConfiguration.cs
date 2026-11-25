using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Blog.Infrastructure.Persistence;

internal sealed class PostRevisionConfiguration : IEntityTypeConfiguration<PostRevision>
{
    public void Configure(EntityTypeBuilder<PostRevision> builder)
    {
        builder.ToTable("post_revisions");
        builder.HasKey(revision => revision.Id);

        // Borrar el post borra su historial en la base misma, sin cargar las versiones (cada una puede pesar 500 KB).
        builder.HasOne<Post>().WithMany().HasForeignKey(revision => revision.PostId).OnDelete(DeleteBehavior.Cascade);

        // Un número por versión en cada post. Sirve también de índice por post (listar, buscar la última, podar), y si
        // dos guardados simultáneos calculan el mismo número, uno falla en vez de duplicarlo.
        builder.HasIndex(revision => new { revision.PostId, revision.Number }).IsUnique();

        builder.Property(revision => revision.Title).IsRequired().HasMaxLength(PostContent.MaxTitleLength);
        builder.Property(revision => revision.Slug).IsRequired().HasMaxLength(Slug.MaxLength);
        builder.Property(revision => revision.Summary).IsRequired().HasMaxLength(PostContent.MaxSummaryLength);
        builder.Property(revision => revision.Body).IsRequired();
        builder.Property(revision => revision.Tags)
            .HasConversion(PostConfiguration.TagsConverter, PostConfiguration.TagsComparer)
            .IsRequired();
        builder.Property(revision => revision.CoverUrl).HasMaxLength(WebUrl.MaxLength);
        builder.Property(revision => revision.CoverAlt).HasMaxLength(PostContent.MaxCoverAltLength);
        builder.Property(revision => revision.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);
    }
}
