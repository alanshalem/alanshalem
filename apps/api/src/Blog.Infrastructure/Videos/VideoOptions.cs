namespace Blog.Infrastructure.Videos;

public sealed class VideoOptions
{
    /// <summary>Ejecutable de ffmpeg (con libsvtav1 y libx264). Por defecto, el del PATH.</summary>
    public string FfmpegPath { get; set; } = "ffmpeg";

    public string FfprobePath { get; set; } = "ffprobe";

    /// <summary>
    /// Originales en espera y salidas de ffmpeg. Nunca dentro de Media:Directory: lo que hay ahí se publica, y el
    /// original trae audio y metadatos. Se vacía en cada arranque.
    /// </summary>
    public string WorkDirectory { get; set; } = "data/video-work";
}
