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

public class VideoAssetTests
{
    private static readonly string Hash = new('b', MediaAsset.HashLength);
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Create_starts_processing_without_poster_sources_or_error()
    {
        var video = VideoAsset.Create(Hash, 1920, 1080, 12.5, Now);

        Assert.Equal(VideoStatus.Processing, video.Status);
        Assert.Null(video.Error);
        Assert.Null(video.Poster);
        Assert.Empty(video.Sources);
        Assert.Empty(video.Warnings);
        Assert.Equal((1920, 1080, 12.5, Now), (video.Width, video.Height, video.DurationSeconds, video.CreatedAtUtc));
    }

    [Theory]
    [InlineData(15.0)]
    [InlineData(15.1)]
    public void Create_accepts_up_to_15_seconds_with_the_rounding_margin_of_containers(double seconds) =>
        Assert.Equal(seconds, VideoAsset.Create(Hash, 1920, 1080, seconds, Now).DurationSeconds);

    [Theory]
    [InlineData(15.2, "El video dura 15,2 s y el máximo es 15 s. Recortalo y volvé a subirlo.")]
    [InlineData(61, "El video dura 61 s y el máximo es 15 s. Recortalo y volvé a subirlo.")]
    public void Create_rejects_a_video_longer_than_15_seconds(double seconds, string expectedMessage)
    {
        var error = Assert.Throws<DomainException>(() => VideoAsset.Create(Hash, 1920, 1080, seconds, Now));

        Assert.Equal(expectedMessage, error.Message);
    }

    [Fact]
    public void Create_applies_the_hero_size_rule_and_its_warning()
    {
        Assert.Equal(
            "Mide 1080×1920 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.",
            Assert.Throws<DomainException>(() => VideoAsset.Create(Hash, 1080, 1920, 10, Now)).Message);
        Assert.Equal(HeroFrame.WarningsFor(1280, 720), VideoAsset.Create(Hash, 1280, 720, 10, Now).Warnings);
    }

    [Fact]
    public void Create_rejects_a_hash_that_could_escape_the_media_folder() =>
        Assert.Throws<ArgumentException>(() => VideoAsset.Create("../../etc", 1920, 1080, 10, Now));

    [Fact]
    public void Paths_follow_the_media_videos_hash_height_codec_scheme()
    {
        var video = VideoAsset.Create(Hash, 1920, 1080, 10, Now);

        Assert.Equal($"videos/{Hash}/1080.av1.mp4", video.RelativePathOf(new VideoVariant(VideoCodec.Av1, 1080)));
        Assert.Equal($"/media/videos/{Hash}/720.h264.mp4", video.UrlOf(new VideoVariant(VideoCodec.H264, 720)));
    }

    [Fact]
    public void MarkReady_stores_poster_and_sources_and_MarkFailed_then_Retry_goes_back_to_processing()
    {
        var poster = MediaAsset.Create(new string('c', MediaAsset.HashLength), 1920, 1080, "#000000", MediaAsset.PlaceholderPrefix + "UklGRg==", Now);
        var ready = VideoAsset.Create(Hash, 1920, 1080, 10, Now);
        VideoSource[] sources = [new(VideoCodec.Av1, 1080, 100), new(VideoCodec.H264, 1080, 200)];

        ready.MarkReady(poster, sources);

        Assert.Equal((VideoStatus.Ready, poster, (string?)null), (ready.Status, ready.Poster, ready.Error));
        Assert.Equal(sources, ready.Sources);

        var failed = VideoAsset.Create(Hash, 1920, 1080, 10, Now);
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
        var video = VideoAsset.Create(Hash, 1920, 1080, 10, Now);
        video.MarkReady(poster, [new(VideoCodec.Av1, 1080, 100)]);

        Assert.Throws<InvalidOperationException>(() => video.MarkFailed("x"));
        Assert.Throws<InvalidOperationException>(() => video.Retry());
    }
}
