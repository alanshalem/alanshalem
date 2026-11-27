using System.Text.Json;
using System.Text.Json.Serialization;
using Blog.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Blog.Infrastructure.Persistence;

internal sealed class VideoAssetConfiguration : IEntityTypeConfiguration<VideoAsset>
{
    // The sources (at most four) go as a JSON array in one column, like a post's tags: they do not justify a separate
    // table. Only what is not derived is stored (codec, height, bytes); the codec as text.
    private static readonly JsonSerializerOptions Json = new() { Converters = { new JsonStringEnumConverter() } };

    private static readonly ValueConverter<IReadOnlyList<VideoSource>, string> SourcesConverter = new(
        sources => JsonSerializer.Serialize(sources.Select(source => new StoredSource(source.Codec, source.Height, source.Bytes)), Json),
        json => (IReadOnlyList<VideoSource>)(JsonSerializer.Deserialize<List<StoredSource>>(json, Json) ?? new List<StoredSource>())
            .Select(source => new VideoSource(source.Codec, source.Height, source.Bytes))
            .ToList());

    // Without a comparer EF cannot detect changes in the collection (and warns about it).
    private static readonly ValueComparer<IReadOnlyList<VideoSource>> SourcesComparer = new(
        (left, right) => left!.SequenceEqual(right!),
        sources => sources.Aggregate(0, (hash, source) => HashCode.Combine(hash, source.GetHashCode())),
        sources => sources.ToList());

    public void Configure(EntityTypeBuilder<VideoAsset> builder)
    {
        builder.ToTable("video_assets");
        builder.HasKey(video => video.Id);

        // Unique: it is what makes the same video with the same edit uploaded twice a single asset.
        builder.Property(video => video.Hash).IsRequired().HasMaxLength(MediaAsset.HashLength);
        builder.HasIndex(video => video.Hash).IsUnique();

        // The edit is a value without an identity of its own: its four fields are columns of video_assets. The final
        // duration is derived from them, so it is not stored.
        builder.ComplexProperty(video => video.Edit, edit =>
        {
            edit.Property(value => value.TrimStart).HasColumnName(nameof(VideoEdit.TrimStart));
            edit.Property(value => value.TrimEnd).HasColumnName(nameof(VideoEdit.TrimEnd));
            edit.Property(value => value.Fade).HasColumnName(nameof(VideoEdit.Fade)).HasConversion<string>().HasMaxLength(10);
            edit.Property(value => value.FadeSeconds).HasColumnName(nameof(VideoEdit.FadeSeconds));
        });
        builder.Ignore(video => video.DurationSeconds);

        builder.Property(video => video.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(video => video.Error).HasMaxLength(VideoAsset.MaxErrorLength);
        builder.Property(video => video.Sources).HasConversion(SourcesConverter, SourcesComparer).IsRequired();
        builder.Property(video => video.CreatedAtUtc).HasConversion(SqliteConventions.UtcConverter);

        // Restrict: the poster is a regular MediaAsset; deleting it would leave the video without a placeholder image.
        builder.HasOne(video => video.Poster)
            .WithMany()
            .HasForeignKey(video => video.PosterId)
            .OnDelete(DeleteBehavior.Restrict);

        // Derived from the dimensions (HeroFrame): not stored.
        builder.Ignore(video => video.Warnings);
    }

    private sealed record StoredSource(VideoCodec Codec, int Height, long Bytes);
}
