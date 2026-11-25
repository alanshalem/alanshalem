using System.Text.Json;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Blog.Infrastructure.Persistence;

internal sealed class PostConfiguration : IEntityTypeConfiguration<Post>
{
    // Las etiquetas se guardan como un arreglo JSON en una sola columna: no justifican una tabla aparte.
    private static readonly ValueConverter<IReadOnlyList<string>, string> TagsConverter = new(
        tags => JsonSerializer.Serialize(tags, (JsonSerializerOptions?)null),
        json => (IReadOnlyList<string>)(JsonSerializer.Deserialize<List<string>>(json, (JsonSerializerOptions?)null) ?? new List<string>()));

    // Sin comparador EF no puede detectar cambios en la colección (y avisa con un warning).
    private static readonly ValueComparer<IReadOnlyList<string>> TagsComparer = new(
        (left, right) => left!.SequenceEqual(right!),
        tags => tags.Aggregate(0, (hash, tag) => HashCode.Combine(hash, tag.GetHashCode())),
        tags => tags.ToList());

    public void Configure(EntityTypeBuilder<Post> builder)
    {
        builder.ToTable("posts");
        builder.HasKey(post => post.Id);

        builder.Property(post => post.Slug).IsRequired().HasMaxLength(Slug.MaxLength);
        builder.HasIndex(post => post.Slug).IsUnique();

        builder.Property(post => post.Title).IsRequired().HasMaxLength(PostContent.MaxTitleLength);
        builder.Property(post => post.Summary).IsRequired().HasMaxLength(PostContent.MaxSummaryLength);
        builder.Property(post => post.Body).IsRequired();
        builder.Property(post => post.Lang).IsRequired().HasMaxLength(10);

        builder.Property(post => post.Tags)
            .HasConversion(TagsConverter, TagsComparer)
            .IsRequired();

        builder.Property(post => post.CoverUrl).HasMaxLength(WebUrl.MaxLength);
        builder.Property(post => post.CoverAlt).HasMaxLength(PostContent.MaxCoverAltLength);

        builder.Property(post => post.Status).HasConversion<string>().HasMaxLength(20);
        builder.HasIndex(post => post.Status);

        builder.Property(post => post.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);
        builder.Property(post => post.UpdatedAtUtc).HasConversion(SqliteConventions.UtcConverter);
        builder.Property(post => post.PublishedAtUtc).HasConversion(SqliteConventions.NullableUtcConverter);
    }
}
