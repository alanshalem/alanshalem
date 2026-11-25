using System.Globalization;
using System.Text.Json;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Videos;

/// <summary>
/// Videos del hero con ffprobe y ffmpeg. Cada versión es una corrida aparte de ffmpeg (una a la vez, con hilos
/// acotados y prioridad baja): decodificar 15 s de nuevo es barato, y así el uso de CPU tiene un techo claro.
/// Acá viven, una sola vez, los parámetros de codificación; qué altos y códecs se generan lo decide el dominio.
/// </summary>
internal sealed class FfmpegVideoTranscoder(IOptions<VideoOptions> options, ILogger<FfmpegVideoTranscoder> logger) : IVideoTranscoder
{
    // Calibrado con un clip de 12 s a 1080p (fractal + patrón de prueba + ruido), midiendo VMAF contra el original
    // ya filtrado: AV1 preset 4 / CRF 35 ≈ 88,8 y H.264 slow / CRF 24 ≈ 89,1, la misma calidad a la vista. AV1 en
    // 10 bits y tune=0 no mejoraron calidad por peso y tardaron más; presets más rápidos pesan 10-25 % más.
    private const int Av1Preset = 4; // 0-13: más bajo comprime más y tarda más
    private const int Av1Crf = 35;
    private const string H264Preset = "slow";
    private const int H264Crf = 24;

    // 8 bits 4:2:0: lo que decodifica por hardware cualquier celular, y el único formato H.264 que acepta Safari.
    private const string PixelFormat = "yuv420p";

    // Mejora suave: hqdn3d quita ruido (sobre todo temporal, que es el que más bits gasta) y unsharp devuelve un poco
    // de nitidez después de achicar. Valores bajos a propósito: limpiar, no "pintar" el video.
    private const string Denoise = "hqdn3d=2:1.5:4:3";
    private const string Sharpen = "unsharp=5:5:0.4:5:5:0";

    private const int MaxFramesPerSecond = 30;

    // El VPS lo comparten varias apps: ffmpeg nunca usa más que estos hilos, aunque haya más núcleos.
    private const int Threads = 2;

    // El póster es el cuadro más representativo entre los primeros (≈ medio segundo): evita un primer cuadro negro
    // o de transición. JPEG casi sin pérdida: el pipeline de imágenes lo optimiza después.
    private const int PosterCandidateFrames = 15;
    private const int PosterJpegQuality = 2; // 2-31: 2 es casi sin pérdida

    private const int LoggedErrorLength = 2000;

    private const string FailedMessage = "ffmpeg no pudo convertir el video. Probá exportarlo de nuevo como MP4 y volvé a subirlo.";
    private const string TimedOutMessage = "El video tardó demasiado en procesarse y se canceló.";

    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(30);

    // 15 s a 1080p en AV1 preset 4 con 2 hilos tardan alrededor de un minuto; esto solo corta un proceso colgado.
    private static readonly TimeSpan EncodeTimeout = TimeSpan.FromMinutes(10);

    public async Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken) =>
        await ProbeStreamAsync(sourcePath, cancellationToken) is { } stream
            ? new VideoProbe(stream.Width, stream.Height, stream.DurationSeconds)
            : null;

    public async Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, CancellationToken cancellationToken)
    {
        var stream = await ProbeStreamAsync(sourcePath, cancellationToken) ?? throw new VideoProcessingException(FailedMessage);
        var workDirectory = Path.Combine(Path.GetFullPath(options.Value.WorkDirectory), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDirectory);
        try
        {
            var files = new List<EncodedVideo>();
            foreach (var variant in variants)
            {
                var output = Path.Combine(workDirectory, $"{variant.Height}.{variant.CodecName}.mp4");
                await RunFfmpegAsync(EncodeArguments(sourcePath, stream, variant, output), cancellationToken);
                files.Add(new EncodedVideo(variant, await File.ReadAllBytesAsync(output, cancellationToken)));
            }

            var poster = Path.Combine(workDirectory, "poster.jpg");
            await RunFfmpegAsync(PosterArguments(sourcePath, stream, variants.Max(variant => variant.Height), poster), cancellationToken);
            return new TranscodedVideo(files, await File.ReadAllBytesAsync(poster, cancellationToken));
        }
        finally
        {
            Directory.Delete(workDirectory, recursive: true);
        }
    }

    private static List<string> EncodeArguments(string source, StreamInfo stream, VideoVariant variant, string output)
    {
        var arguments = InputArguments(source);
        arguments.AddRange(["-vf", Filters(stream, variant.Height)]);
        arguments.AddRange(variant.Codec switch
        {
            VideoCodec.Av1 => ["-c:v", "libsvtav1", "-preset", Invariant(Av1Preset), "-crf", Invariant(Av1Crf),
                "-svtav1-params", $"lp={Threads}"],
            VideoCodec.H264 => ["-c:v", "libx264", "-preset", H264Preset, "-crf", Invariant(H264Crf), "-profile:v", "high",
                "-threads", Invariant(Threads)],
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Codec, "Códec de video desconocido."),
        });
        // +faststart: el índice va al principio y el navegador empieza a reproducir sin bajar el archivo entero.
        arguments.AddRange(["-pix_fmt", PixelFormat, "-movflags", "+faststart", "-f", "mp4", output]);
        return arguments;
    }

    private static List<string> PosterArguments(string source, StreamInfo stream, int height, string output)
    {
        var arguments = InputArguments(source);
        arguments.AddRange(["-vf", $"{Filters(stream, height)},thumbnail={PosterCandidateFrames}",
            "-frames:v", "1", "-q:v", Invariant(PosterJpegQuality), "-update", "1", "-f", "image2", output]);
        return arguments;
    }

    // Solo la primera pista de video: -an saca el audio, y sin subtítulos, datos, metadatos (GPS, modelo del
    // teléfono) ni capítulos. ffmpeg aplica solo la rotación que guardan los teléfonos antes de los filtros.
    private static List<string> InputArguments(string source) =>
    [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-threads", Invariant(Threads), "-i", source,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-filter_threads", Invariant(Threads),
    ];

    // scale=-2:alto mantiene la proporción con ancho par (lo exige yuv420p); el dominio ya garantiza que nunca agranda.
    private static string Filters(StreamInfo stream, int height)
    {
        List<string> filters = [];
        if (FrameRateCap(stream) is { } fps)
        {
            filters.Add($"fps={fps}");
        }

        filters.AddRange([Denoise, $"scale=-2:{height}:flags=lanczos", Sharpen]);
        return string.Join(',', filters);
    }

    /// <summary>
    /// Más de 30 fps se divide por el menor entero que lo deja en 30 o menos (60 → 30, 50 → 25, 120 → 30): se
    /// descartan cuadros parejos y el movimiento sigue fluido. Hasta 30 fps no se toca (null).
    /// </summary>
    private static string? FrameRateCap(StreamInfo stream)
    {
        if (stream.FrameRate is not var (numerator, denominator) || numerator <= (long)MaxFramesPerSecond * denominator)
        {
            return null;
        }

        var divisor = (numerator + ((long)MaxFramesPerSecond * denominator) - 1) / ((long)MaxFramesPerSecond * denominator);
        return $"{numerator}/{denominator * divisor}";
    }

    private async Task RunFfmpegAsync(List<string> arguments, CancellationToken cancellationToken)
    {
        ExternalProcess.Result result;
        try
        {
            result = await ExternalProcess.RunAsync(options.Value.FfmpegPath, arguments, EncodeTimeout, cancellationToken);
        }
        catch (TimeoutException exception)
        {
            logger.LogWarning(exception, "ffmpeg superó el tiempo máximo; se canceló el video.");
            throw new VideoProcessingException(TimedOutMessage);
        }

        if (result.ExitCode != 0)
        {
            logger.LogWarning("ffmpeg terminó con código {ExitCode}: {Error}", result.ExitCode, Tail(result.Error));
            throw new VideoProcessingException(FailedMessage);
        }
    }

    /// <summary>
    /// Ancho y alto como se ven (con la rotación aplicada), duración del contenedor (la del stream suele faltar en
    /// MKV/WebM) y fps promedio. Null si no hay una pista de video con tamaño y duración.
    /// </summary>
    private async Task<StreamInfo?> ProbeStreamAsync(string sourcePath, CancellationToken cancellationToken)
    {
        ExternalProcess.Result result;
        try
        {
            result = await ExternalProcess.RunAsync(options.Value.FfprobePath,
            [
                "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,avg_frame_rate:stream_side_data=rotation:format=duration",
                "-of", "json", sourcePath,
            ], ProbeTimeout, cancellationToken);
        }
        catch (TimeoutException exception)
        {
            logger.LogWarning(exception, "ffprobe superó el tiempo máximo; el video se trata como ilegible.");
            return null;
        }

        if (result.ExitCode != 0)
        {
            logger.LogInformation("ffprobe no pudo leer el video ({ExitCode}): {Error}", result.ExitCode, Tail(result.Error));
            return null;
        }

        return ParseProbe(result.Output);
    }

    private static StreamInfo? ParseProbe(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!root.TryGetProperty("streams", out var streams) || streams.GetArrayLength() == 0
            || !root.TryGetProperty("format", out var format)
            || !format.TryGetProperty("duration", out var durationText)
            || !double.TryParse(durationText.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var duration)
            || duration <= 0)
        {
            return null;
        }

        var stream = streams[0];
        if (!stream.TryGetProperty("width", out var widthValue) || !stream.TryGetProperty("height", out var heightValue))
        {
            return null;
        }

        var (width, height) = (widthValue.GetInt32(), heightValue.GetInt32());
        // Un teléfono guarda los píxeles acostados con una rotación de ±90°: se ve con ancho y alto intercambiados.
        if (Math.Abs(Rotation(stream)) % 180 == 90)
        {
            (width, height) = (height, width);
        }

        return new StreamInfo(width, height, duration, FrameRate(stream));
    }

    private static int Rotation(JsonElement stream)
    {
        if (!stream.TryGetProperty("side_data_list", out var sideData))
        {
            return 0;
        }

        foreach (var item in sideData.EnumerateArray())
        {
            if (item.TryGetProperty("rotation", out var rotation) && rotation.TryGetInt32(out var degrees))
            {
                return degrees;
            }
        }

        return 0;
    }

    // "30000/1001" → (30000, 1001). "0/0" (desconocido) → null: no se limita lo que no se sabe.
    private static (long Numerator, long Denominator)? FrameRate(JsonElement stream)
    {
        var parts = stream.TryGetProperty("avg_frame_rate", out var rate) ? rate.GetString()?.Split('/') : null;
        return parts is [var numerator, var denominator]
               && long.TryParse(numerator, CultureInfo.InvariantCulture, out var top) && top > 0
               && long.TryParse(denominator, CultureInfo.InvariantCulture, out var bottom) && bottom > 0
            ? (top, bottom)
            : null;
    }

    private static string Tail(string text) => text.Length > LoggedErrorLength ? text[^LoggedErrorLength..] : text;

    private static string Invariant(int value) => value.ToString(CultureInfo.InvariantCulture);

    private sealed record StreamInfo(int Width, int Height, double DurationSeconds, (long Numerator, long Denominator)? FrameRate);
}
