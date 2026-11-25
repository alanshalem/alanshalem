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
    // Las fuentes (a lo sumo cuatro) van como arreglo JSON en una columna, igual que las etiquetas de un post: no
    // justifican una tabla aparte. Se guarda solo lo que no se deriva (códec, alto, bytes); el códec como texto.
    private static readonly JsonSerializerOptions Json = new() { Converters = { new JsonStringEnumConverter() } };

    private static readonly ValueConverter<IReadOnlyList<VideoSource>, string> SourcesConverter = new(
        sources => JsonSerializer.Serialize(sources.Select(source => new StoredSource(source.Codec, source.Height, source.Bytes)), Json),
        json => (IReadOnlyList<VideoSource>)(JsonSerializer.Deserialize<List<StoredSource>>(json, Json) ?? new List<StoredSource>())
            .Select(source => new VideoSource(source.Codec, source.Height, source.Bytes))
            .ToList());

    // Sin comparador EF no puede detectar cambios en la colección (y avisa con un warning).
    private static readonly ValueComparer<IReadOnlyList<VideoSource>> SourcesComparer = new(
        (left, right) => left!.SequenceEqual(right!),
        sources => sources.Aggregate(0, (hash, source) => HashCode.Combine(hash, source.GetHashCode())),
        sources => sources.ToList());

    public void Configure(EntityTypeBuilder<VideoAsset> builder)
    {
        builder.ToTable("video_assets");
        builder.HasKey(video => video.Id);

        // Único: es lo que hace que el mismo video con la misma edición subido dos veces sea un solo asset.
        builder.Property(video => video.Hash).IsRequired().HasMaxLength(MediaAsset.HashLength);
        builder.HasIndex(video => video.Hash).IsUnique();

        // La edición es un valor sin identidad propia: sus cuatro campos son columnas de video_assets. La duración final
        // se deriva de ellos, así que no se guarda.
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

        // Restrict: el póster es un MediaAsset común; borrarlo dejaría al video sin imagen de espera.
        builder.HasOne(video => video.Poster)
            .WithMany()
            .HasForeignKey(video => video.PosterId)
            .OnDelete(DeleteBehavior.Restrict);

        // Se derivan de las dimensiones (HeroFrame): no se guardan.
        builder.Ignore(video => video.Warnings);
    }

    private sealed record StoredSource(VideoCodec Codec, int Height, long Bytes);
}
