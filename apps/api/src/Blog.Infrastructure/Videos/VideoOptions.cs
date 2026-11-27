namespace Blog.Infrastructure.Videos;

public sealed class VideoOptions
{
    /// <summary>ffmpeg executable (with libsvtav1 and libx264). By default, the one on the PATH.</summary>
    public string FfmpegPath { get; set; } = "ffmpeg";

    public string FfprobePath { get; set; } = "ffprobe";

    /// <summary>
    /// Waiting originals and ffmpeg outputs. Never inside Media:Directory: what is there gets published, and the
    /// original carries audio and metadata. Emptied on every start.
    /// </summary>
    public string WorkDirectory { get; set; } = "data/video-work";
}
