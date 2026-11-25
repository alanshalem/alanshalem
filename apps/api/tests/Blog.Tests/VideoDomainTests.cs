using Blog.Domain;

namespace Blog.Tests;

public class HeroFrameTests
{
    [Theory]
    [InlineData(1280, 720)]
    [InlineData(1919, 1080)]
    [InlineData(1920, 1079)]
    [InlineData(2560, 1000)]
    public void Below_the_ideal_size_is_accepted_with_a_warning_that_names_both_sizes(int width, int height)
    {
        HeroFrame.Ensure(width, height);

        Assert.Equal(
            [$"Mide {width}×{height}: se acepta, pero en pantallas grandes se va a ver menos nítida. Ideal: 1920×1080 o más, horizontal 16:9."],
            HeroFrame.WarningsFor(width, height));
    }

    [Theory]
    [InlineData(1920, 1080)]
    [InlineData(3840, 2160)]
    [InlineData(2560, 1080)]
    public void The_ideal_size_or_larger_has_no_warning(int width, int height)
    {
        HeroFrame.Ensure(width, height);

        Assert.Empty(HeroFrame.WarningsFor(width, height));
    }

    [Theory]
    [InlineData(1080, 1920)]
    [InlineData(2000, 2000)]
    [InlineData(2399, 2000)]
    public void Portrait_square_or_nearly_square_is_rejected_naming_the_received_and_ideal_sizes(int width, int height)
    {
        var error = Assert.Throws<DomainException>(() => HeroFrame.Ensure(width, height));

        Assert.Equal(
            $"Mide {width}×{height} y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.",
            error.Message);
    }

    [Theory]
    [InlineData(1279, 1000)]
    [InlineData(1500, 719)]
    [InlineData(640, 360)]
    public void Smaller_than_1280x720_is_rejected_naming_the_received_minimum_and_ideal_sizes(int width, int height)
    {
        var error = Assert.Throws<DomainException>(() => HeroFrame.Ensure(width, height));

        Assert.Equal($"Mide {width}×{height} y el mínimo es 1280×720. Ideal: 1920×1080 o más, horizontal 16:9.", error.Message);
    }
}

public class VideoVariantTests
{
    [Theory]
    [InlineData(720, new[] { 720 })]
    [InlineData(1079, new[] { 720 })]
    [InlineData(1080, new[] { 720, 1080 })]
    [InlineData(2160, new[] { 720, 1080 })]
    public void HeightsFor_never_upscales(int sourceHeight, int[] expected) =>
        Assert.Equal(expected, VideoVariant.HeightsFor(sourceHeight));

    [Fact]
    public void For_combines_every_codec_with_every_height_av1_first() =>
        Assert.Equal(
            [
                new VideoVariant(VideoCodec.Av1, 720), new VideoVariant(VideoCodec.Av1, 1080),
                new VideoVariant(VideoCodec.H264, 720), new VideoVariant(VideoCodec.H264, 1080),
            ],
            VideoVariant.For(1440));

    [Theory]
    [InlineData(VideoCodec.Av1, "av1")]
    [InlineData(VideoCodec.H264, "h264")]
    public void CodecName_matches_the_codec(VideoCodec codec, string name) =>
        Assert.Equal(name, new VideoVariant(codec, 720).CodecName);
}

public class VideoEditTests
{
    [Fact]
    public void Without_fields_it_is_the_first_15_seconds_with_a_1_second_loop()
    {
        var edit = VideoEdit.DefaultFor(20);

        Assert.Equal((0, 15, VideoFade.Loop, 1), (edit.TrimStart, edit.TrimEnd, edit.Fade, edit.FadeSeconds));
        Assert.Equal(15, edit.TrimmedSeconds);
        Assert.Equal(14, edit.OutputSeconds);
        Assert.Equal(edit, VideoEdit.Create(20, null, null, null, null));
    }

    [Fact]
    public void Without_fields_a_short_video_is_kept_whole()
    {
        var edit = VideoEdit.DefaultFor(8.25);

        Assert.Equal((0, 8.25), (edit.TrimStart, edit.TrimEnd));
        Assert.Equal(7.25, edit.OutputSeconds);
    }

    [Theory]
    [InlineData(VideoFade.Loop, 12, 3)]
    [InlineData(VideoFade.Black, 13, 3)]
    [InlineData(VideoFade.None, 13, 2)]
    public void Output_duration_and_first_visible_second_depend_on_the_fade(VideoFade fade, double output, double firstVisible)
    {
        var edit = VideoEdit.Create(20, 2, 15, fade, 1);

        Assert.Equal(13, edit.TrimmedSeconds);
        Assert.Equal(output, edit.OutputSeconds);
        Assert.Equal(firstVisible, edit.FirstVisibleSecond);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(0, 15)]
    [InlineData(5, 20.05)]
    public void The_trimmed_length_can_be_from_1_to_15_seconds_with_the_rounding_margin(double start, double end) =>
        Assert.Equal(end - start, VideoEdit.Create(20.1, start, end, VideoFade.None, null).TrimmedSeconds, precision: 3);

    [Theory]
    [InlineData(0, 15.2, "El tramo elegido dura 15,2 s y el máximo es 15 s. Acortalo y volvé a subirlo.")]
    [InlineData(2, 20, "El tramo elegido dura 18 s y el máximo es 15 s. Acortalo y volvé a subirlo.")]
    [InlineData(5, 5.9, "El tramo elegido dura 0,9 s y el mínimo es 1 s.")]
    [InlineData(-0.5, 3, "El inicio del recorte no puede ser negativo.")]
    [InlineData(4, 4, "El fin del recorte tiene que ser posterior al inicio.")]
    [InlineData(4, 3, "El fin del recorte tiene que ser posterior al inicio.")]
    [InlineData(10, 20.5, "El fin del recorte (20,5 s) pasa el final del video, que dura 20 s.")]
    public void A_trim_out_of_bounds_is_rejected_in_spanish(double start, double end, string expectedMessage)
    {
        var error = Assert.Throws<DomainException>(() => VideoEdit.Create(20, start, end, VideoFade.None, null));

        Assert.Equal(expectedMessage, error.Message);
    }

    [Fact]
    public void A_video_shorter_than_1_second_is_rejected_even_without_fields() =>
        Assert.Equal(
            "El tramo elegido dura 0,6 s y el mínimo es 1 s.",
            Assert.Throws<DomainException>(() => VideoEdit.DefaultFor(0.6)).Message);

    [Fact]
    public void An_end_within_the_margin_past_the_real_end_is_the_real_end() =>
        Assert.Equal(VideoEdit.Create(10.02, 0, 10.02, VideoFade.None, null), VideoEdit.Create(10.02, 0, 10.1, VideoFade.None, null));

    [Theory]
    [InlineData(VideoFade.Loop, 2, 3)]
    [InlineData(VideoFade.Black, 2, 3.9)]
    [InlineData(VideoFade.Loop, 1, 1.5)]
    public void A_fade_longer_than_half_the_trim_is_rejected(VideoFade fade, double fadeSeconds, double end)
    {
        var error = Assert.Throws<DomainException>(() => VideoEdit.Create(20, 0, end, fade, fadeSeconds));

        Assert.Equal(
            $"Un fundido de {fadeSeconds} s necesita un tramo de al menos {fadeSeconds * 2} s y el elegido dura {end.ToString(new System.Globalization.NumberFormatInfo { NumberDecimalSeparator = "," })} s. Elegí un fundido más corto o un tramo más largo.",
            error.Message);
    }

    [Fact]
    public void A_fade_of_exactly_half_the_trim_fits_and_none_ignores_the_fade_length()
    {
        Assert.Equal(2, VideoEdit.Create(20, 0, 4, VideoFade.Loop, 2).OutputSeconds);
        Assert.Equal(4, VideoEdit.Create(20, 0, 4, VideoFade.Black, 2).OutputSeconds);
        Assert.Equal(1, VideoEdit.Create(20, 0, 1, VideoFade.None, 2).OutputSeconds);
    }

    [Theory]
    [InlineData(VideoFade.Loop, 1.5)]
    [InlineData(VideoFade.Black, 0)]
    [InlineData(VideoFade.None, 3)]
    public void The_fade_length_is_short_medium_or_long(VideoFade fade, double fadeSeconds)
    {
        var error = Assert.Throws<DomainException>(() => VideoEdit.Create(20, 0, 10, fade, fadeSeconds));

        Assert.Equal("La duración del fundido tiene que ser 0,5, 1 o 2 s.", error.Message);
    }

    [Fact]
    public void Equivalent_requests_normalize_to_the_same_edit_and_key()
    {
        var edit = VideoEdit.Create(20, 2, 15, VideoFade.Loop, 1);

        Assert.Equal("2-15-loop-1", edit.Key);
        Assert.Equal(edit, VideoEdit.Create(20, 2.0004, 14.9996, VideoFade.Loop, 1));
        // Sin fundido, su duración no cambia nada: queda en la de por defecto.
        var none = VideoEdit.Create(20, 2.5, 10, VideoFade.None, 2);
        Assert.Equal(VideoEdit.Create(20, 2.5, 10, VideoFade.None, 0.5), none);
        Assert.Equal("2.5-10-none-1", none.Key);
        Assert.NotEqual(edit.Key, VideoEdit.Create(20, 2, 15, VideoFade.Black, 1).Key);
    }

    [Fact]
    public void Non_finite_numbers_are_a_programming_error() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => VideoEdit.Create(20, double.NaN, 10, VideoFade.None, null));
}

public class VideoAssetTests
{
    private static readonly string Hash = new('b', MediaAsset.HashLength);
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
    private static readonly VideoEdit Edit = VideoEdit.Create(20, 2, 15, VideoFade.Loop, 1);

    [Fact]
    public void Create_starts_processing_without_poster_sources_or_error_and_lasts_the_output_duration()
    {
        var video = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);

        Assert.Equal(VideoStatus.Processing, video.Status);
        Assert.Null(video.Error);
        Assert.Null(video.Poster);
        Assert.Empty(video.Sources);
        Assert.Empty(video.Warnings);
        Assert.Equal((1920, 1080, Edit, 12.0, Now), (video.Width, video.Height, video.Edit, video.DurationSeconds, video.CreatedAtUtc));
    }

    [Fact]
    public void The_same_file_with_the_same_edit_is_the_same_asset_and_another_edit_is_another()
    {
        var hash = VideoAsset.Create(Hash, 1920, 1080, Edit, Now).Hash;

        Assert.Matches("^[0-9a-f]{64}$", hash);
        Assert.NotEqual(Hash, hash);
        Assert.Equal(hash, VideoAsset.HashOf(Hash, VideoEdit.Create(20, 2.0001, 15, VideoFade.Loop, 1)));
        Assert.NotEqual(hash, VideoAsset.HashOf(Hash, VideoEdit.Create(20, 3, 15, VideoFade.Loop, 1)));
        Assert.NotEqual(hash, VideoAsset.HashOf(Hash, VideoEdit.Create(20, 2, 15, VideoFade.Loop, 2)));
        Assert.NotEqual(hash, VideoAsset.HashOf(new string('c', MediaAsset.HashLength), Edit));
    }

    [Fact]
    public void Create_applies_the_hero_size_rule_and_its_warning()
    {
        Assert.Equal(
            "Mide 1080×1920 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.",
            Assert.Throws<DomainException>(() => VideoAsset.Create(Hash, 1080, 1920, Edit, Now)).Message);
        Assert.Equal(HeroFrame.WarningsFor(1280, 720), VideoAsset.Create(Hash, 1280, 720, Edit, Now).Warnings);
    }

    [Fact]
    public void Create_rejects_a_hash_that_could_escape_the_media_folder() =>
        Assert.Throws<ArgumentException>(() => VideoAsset.Create("../../etc", 1920, 1080, Edit, Now));

    [Fact]
    public void Paths_follow_the_media_videos_hash_height_codec_scheme()
    {
        var video = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);

        Assert.Equal($"videos/{video.Hash}/1080.av1.mp4", video.RelativePathOf(new VideoVariant(VideoCodec.Av1, 1080)));
        Assert.Equal($"/media/videos/{video.Hash}/720.h264.mp4", video.UrlOf(new VideoVariant(VideoCodec.H264, 720)));
    }

    [Fact]
    public void MarkReady_stores_poster_and_sources_and_MarkFailed_then_Retry_goes_back_to_processing()
    {
        var poster = MediaAsset.Create(new string('c', MediaAsset.HashLength), 1920, 1080, "#000000", MediaAsset.PlaceholderPrefix + "UklGRg==", Now);
        var ready = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);
        VideoSource[] sources = [new(VideoCodec.Av1, 1080, 100), new(VideoCodec.H264, 1080, 200)];

        ready.MarkReady(poster, sources);

        Assert.Equal((VideoStatus.Ready, poster, (string?)null), (ready.Status, ready.Poster, ready.Error));
        Assert.Equal(sources, ready.Sources);

        var failed = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);
        failed.MarkFailed(new string('e', VideoAsset.MaxErrorLength + 50));
        Assert.Equal(VideoStatus.Failed, failed.Status);
        Assert.Equal(VideoAsset.MaxErrorLength, failed.Error!.Length);

        failed.Retry();
        Assert.Equal((VideoStatus.Processing, (string?)null), (failed.Status, failed.Error));
    }

    [Fact]
    public void A_ready_video_cannot_be_marked_again()
    {
        var poster = MediaAsset.Create(new string('c', MediaAsset.HashLength), 1920, 1080, "#000000", MediaAsset.PlaceholderPrefix + "UklGRg==", Now);
        var video = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);
        video.MarkReady(poster, [new(VideoCodec.Av1, 1080, 100)]);

        Assert.Throws<InvalidOperationException>(() => video.MarkFailed("x"));
        Assert.Throws<InvalidOperationException>(() => video.MarkReady(poster, [new(VideoCodec.Av1, 1080, 100)]));
    }

    [Fact]
    public void Retry_of_a_ready_video_drops_its_poster_and_sources_and_a_processing_video_cannot_retry()
    {
        var poster = MediaAsset.Create(new string('c', MediaAsset.HashLength), 1920, 1080, "#000000", MediaAsset.PlaceholderPrefix + "UklGRg==", Now);
        var video = VideoAsset.Create(Hash, 1920, 1080, Edit, Now);
        Assert.Throws<InvalidOperationException>(() => video.Retry());
        video.MarkReady(poster, [new(VideoCodec.Av1, 1080, 100)]);

        video.Retry();

        Assert.Equal(VideoStatus.Processing, video.Status);
        Assert.Null(video.Poster);
        Assert.Null(video.PosterId);
        Assert.Empty(video.Sources);
    }
}
