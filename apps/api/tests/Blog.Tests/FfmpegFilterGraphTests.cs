using System.Globalization;
using Blog.Domain;
using Blog.Infrastructure.Videos;

namespace Blog.Tests;

/// <summary>The filter graphs and bitrate ceilings the adapter builds, without running ffmpeg.</summary>
public class FfmpegFilterGraphTests
{
    private const string Enhanced1080 = "fps=30/1,hqdn3d=2:1.5:4:3,scale=-2:1080:flags=lanczos,unsharp=5:5:0.4:5:5:0";

    [Fact]
    public void None_is_only_the_soft_enhancement() =>
        Assert.Equal(Enhanced1080, FfmpegVideoTranscoder.FilterGraph("30/1", 1080, VideoEdit.Create(20, 2, 15, VideoFade.None, null)));

    [Fact]
    public void Black_fades_in_at_the_start_and_out_at_the_end_of_the_trim() =>
        Assert.Equal(
            $"{Enhanced1080},fade=t=in:st=0:d=0.5,fade=t=out:st=12.5:d=0.5",
            FfmpegVideoTranscoder.FilterGraph("30/1", 1080, VideoEdit.Create(20, 2, 15, VideoFade.Black, 0.5)));

    [Fact]
    public void Loop_crossfades_the_rest_into_the_intro_ending_one_fade_earlier() =>
        Assert.Equal(
            $"{Enhanced1080},split[full][copy];" +
            "[full]trim=start=1,setpts=PTS-STARTPTS[rest];" +
            "[copy]trim=end=1,setpts=PTS-STARTPTS[intro];" +
            "[rest][intro]xfade=transition=fade:duration=1:offset=11",
            FfmpegVideoTranscoder.FilterGraph("30/1", 1080, VideoEdit.Create(20, 2, 15, VideoFade.Loop, 1)));

    [Fact]
    public void Times_use_a_decimal_point_whatever_the_server_culture()
    {
        var previous = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("es-AR");
        try
        {
            Assert.Equal(
                "hqdn3d=2:1.5:4:3,scale=-2:720:flags=lanczos,unsharp=5:5:0.4:5:5:0,fade=t=in:st=0:d=0.5,fade=t=out:st=3.8:d=0.5",
                FfmpegVideoTranscoder.FilterGraph(null, 720, VideoEdit.Create(20, 1.2, 5.5, VideoFade.Black, 0.5)));
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    [Theory]
    [InlineData(VideoCodec.Av1, 720, 1200)]
    [InlineData(VideoCodec.Av1, 1080, 2500)]
    [InlineData(VideoCodec.H264, 720, 1920)]
    [InlineData(VideoCodec.H264, 1080, 4000)]
    public void Each_version_has_its_bitrate_cap(VideoCodec codec, int height, int expectedKbps) =>
        Assert.Equal(expectedKbps, FfmpegVideoTranscoder.MaxKilobitsPerSecond(new VideoVariant(codec, height)));
}
