namespace Blog.Application.Media;

/// <summary>
/// Optional capability of an <see cref="Abstractions.IImageProcessor"/>: whether its decoder has a loader for a format
/// <see cref="ImageSniffer.DetectExtension"/> names. The bundled libvips decides what can be read (SVG needs its
/// rasterizer, for example), so a missing loader is answered with a message naming the format instead of the
/// "damaged file" one a failed decode would give. A processor without this capability is trusted for every format.
/// </summary>
public interface IImageFormatSupport
{
    /// <param name="extension">As returned by <see cref="ImageSniffer.DetectExtension"/> ("png", "tif", "svg"…).</param>
    bool CanDecode(string extension);
}
