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

        // Deleting the post deletes its history in the database itself, without loading the versions (each can weigh 500 KB).
        builder.HasOne<Post>().WithMany().HasForeignKey(revision => revision.PostId).OnDelete(DeleteBehavior.Cascade);

        // One number per version in each post. It also serves as the per-post index (listing, finding the latest,
        // pruning), and if two simultaneous saves compute the same number, one fails instead of duplicating it.
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
