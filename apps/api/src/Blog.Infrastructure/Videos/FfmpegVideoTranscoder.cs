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
/// Acá viven, una sola vez, los parámetros de codificación y los filtros; qué altos y códecs se generan y qué
/// significa cada edición lo decide el dominio.
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

    // CRF con techo de bitrate: el CRF manda en las escenas fáciles y el techo frena las difíciles (ruido, mucho
    // movimiento). Es un fondo en loop detrás de texto: un poco menos de detalle en el peor caso no se nota; varios MB
    // de más en cada visita, sí. H.264 necesita ~1,6× los bits de AV1 para verse igual. En x264 el techo es maxrate
    // con un búfer de 1 s (es lo que el clip entero puede pasarse del techo); en SVT-AV1, su modo "capped CRF" (mbr),
    // sin exceso permitido: con su exceso por defecto se pasaba un 30 %, y con 10 % llegaba justo al 10 %. Medido en
    // 12 s a 1080p: un clip con ruido fuerte bajó de 13,6 MB a 3,1 MB en AV1 (y de 55,8 MB a ~6 MB en H.264); un zoom
    // lento sobre una imagen con detalle casi no cambió (2,3 → 2,1 MB, VMAF 94).
    private const int Av1MaxKbps720 = 1200;
    private const int Av1MaxKbps1080 = 2500;
    private const int Av1MaxOvershootPercent = 0;
    private const double H264BitrateFactor = 1.6;
    private const int H264BufferSeconds = 1;

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

    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(30);

    // Medido en la verificación del hero: un clip de 15 s a 1080p con estos parámetros tardó 211 s en procesarse
    // entero (todas sus versiones). El tope es por corrida de ffmpeg y deja margen de sobra: solo corta un proceso colgado.
    private static readonly TimeSpan EncodeTimeout = TimeSpan.FromMinutes(10);

    public async Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken) =>
        await ProbeStreamAsync(sourcePath, cancellationToken) is { } stream
            ? new VideoProbe(stream.Width, stream.Height, stream.DurationSeconds)
            : null;

    public async Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, VideoEdit edit, CancellationToken cancellationToken)
    {
        var stream = await ProbeStreamAsync(sourcePath, cancellationToken) ?? throw new VideoProcessingException(MessageKeys.VideoProcessingFailed);
        var workDirectory = Path.Combine(Path.GetFullPath(options.Value.WorkDirectory), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDirectory);
        try
        {
            var files = new List<EncodedVideo>();
            foreach (var variant in variants)
            {
                var output = Path.Combine(workDirectory, $"{variant.Height}.{variant.CodecName}.mp4");
                await RunFfmpegAsync(EncodeArguments(sourcePath, stream, variant, edit, output), cancellationToken);
                files.Add(new EncodedVideo(variant, await File.ReadAllBytesAsync(output, cancellationToken)));
            }

            var poster = Path.Combine(workDirectory, "poster.jpg");
            await RunFfmpegAsync(
                PosterArguments(sourcePath, stream, variants.Max(variant => variant.Height), edit, poster), cancellationToken);
            return new TranscodedVideo(files, await File.ReadAllBytesAsync(poster, cancellationToken));
        }
        finally
        {
            Directory.Delete(workDirectory, recursive: true);
        }
    }

    /// <summary>
    /// El grafo de filtros de una versión: la mejora suave y, según la edición, el fundido. Recibe el tramo ya
    /// recortado (con -ss/-t en la entrada), así que sus tiempos empiezan en 0.
    /// <list type="bullet">
    /// <item>black: fundido de entrada desde negro y de salida a negro, cada uno de FadeSeconds.</item>
    /// <item>loop: el tramo se parte en el principio (los primeros FadeSeconds) y el resto; el resto se funde con el
    /// principio al final (xfade). Termina en el cuadro anterior al primero del resto, que es con el que arranca: al
    /// repetirse no hay salto. Dura el recorte menos FadeSeconds.</item>
    /// <item>none: corte directo.</item>
    /// </list>
    /// </summary>
    internal static string FilterGraph(string? frameRate, int height, VideoEdit edit)
    {
        var enhanced = Enhancement(frameRate, height);
        var fade = Seconds(edit.FadeSeconds);
        return edit.Fade switch
        {
            VideoFade.None => enhanced,
            VideoFade.Black =>
                $"{enhanced},fade=t=in:st=0:d={fade},fade=t=out:st={Seconds(edit.TrimmedSeconds - edit.FadeSeconds)}:d={fade}",
            VideoFade.Loop =>
                $"{enhanced},split[full][copy];" +
                $"[full]trim=start={fade},setpts=PTS-STARTPTS[rest];" +
                $"[copy]trim=end={fade},setpts=PTS-STARTPTS[intro];" +
                $"[rest][intro]xfade=transition=fade:duration={fade}:offset={Seconds(edit.TrimmedSeconds - (2 * edit.FadeSeconds))}",
            _ => throw new ArgumentOutOfRangeException(nameof(edit), edit.Fade, "Fundido desconocido."),
        };
    }

    /// <summary>
    /// Mejora suave a ese alto. scale=-2:alto mantiene la proporción con ancho par (lo exige yuv420p); el dominio ya
    /// garantiza que nunca agranda. fps va primero: menos cuadros que filtrar, y cuadros constantes para xfade.
    /// </summary>
    internal static string Enhancement(string? frameRate, int height)
    {
        var filters = $"{Denoise},scale=-2:{height}:flags=lanczos,{Sharpen}";
        return frameRate is null ? filters : $"fps={frameRate},{filters}";
    }

    private static List<string> EncodeArguments(string source, StreamInfo stream, VideoVariant variant, VideoEdit edit, string output)
    {
        var arguments = InputArguments(source, edit.TrimStart, edit.TrimmedSeconds);
        arguments.AddRange(["-vf", FilterGraph(OutputFrameRate(stream), variant.Height, edit)]);
        var maxKbps = MaxKilobitsPerSecond(variant);
        arguments.AddRange(variant.Codec switch
        {
            VideoCodec.Av1 => ["-c:v", "libsvtav1", "-preset", Invariant(Av1Preset), "-crf", Invariant(Av1Crf),
                "-svtav1-params", $"lp={Threads}:mbr={maxKbps}:mbr-overshoot-pct={Av1MaxOvershootPercent}"],
            VideoCodec.H264 => ["-c:v", "libx264", "-preset", H264Preset, "-crf", Invariant(H264Crf), "-profile:v", "high",
                "-maxrate", $"{maxKbps}k", "-bufsize", $"{maxKbps * H264BufferSeconds}k", "-threads", Invariant(Threads)],
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Codec, "Códec de video desconocido."),
        });
        // +faststart: el índice va al principio y el navegador empieza a reproducir sin bajar el archivo entero.
        arguments.AddRange(["-pix_fmt", PixelFormat, "-movflags", "+faststart", "-f", "mp4", output]);
        return arguments;
    }

    /// <summary>
    /// Techo de bitrate de cada versión. Lo que sostiene el fondo es la de 1080p; la de 720p va a pantallas chicas.
    /// </summary>
    internal static int MaxKilobitsPerSecond(VideoVariant variant)
    {
        var av1 = variant.Height switch
        {
            720 => Av1MaxKbps720,
            1080 => Av1MaxKbps1080,
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Height, "Alto sin techo de bitrate calibrado."),
        };
        return variant.Codec == VideoCodec.Av1 ? av1 : (int)(av1 * H264BitrateFactor);
    }

    // El póster sale del primer cuadro visible de la edición (después del fundido de entrada en black; donde arranca
    // el video final en loop), así coincide con lo que se ve cuando empieza a reproducirse. La lectura termina en el fin
    // del recorte: si no, con un tramo corto (o pocos fps) los candidatos de thumbnail llegarían a lo que se cortó. Si
    // quedan menos de PosterCandidateFrames, thumbnail elige entre los que hay al terminar la entrada.
    private static List<string> PosterArguments(string source, StreamInfo stream, int height, VideoEdit edit, string output)
    {
        var arguments = InputArguments(source, edit.FirstVisibleSecond, edit.TrimEnd - edit.FirstVisibleSecond);
        arguments.AddRange(["-vf", $"{Enhancement(OutputFrameRate(stream), height)},thumbnail={PosterCandidateFrames}",
            "-frames:v", "1", "-q:v", Invariant(PosterJpegQuality), "-update", "1", "-f", "image2", output]);
        return arguments;
    }

    // Solo la primera pista de video: -an saca el audio, y sin subtítulos, datos, metadatos (GPS, modelo del
    // teléfono) ni capítulos. ffmpeg aplica solo la rotación que guardan los teléfonos antes de los filtros.
    // -ss antes de -i busca rápido hasta el cuadro clave previo y decodifica desde ahí descartando hasta el segundo
    // exacto (el recorte es preciso al cuadro); -t corta la lectura al largo del tramo.
    private static List<string> InputArguments(string source, double start, double duration) =>
    [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-threads", Invariant(Threads), "-ss", Seconds(start), "-t", Seconds(duration),
        "-i", source,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-filter_threads", Invariant(Threads),
    ];

    /// <summary>
    /// Los fps de salida, siempre explícitos: deja cuadros constantes (los teléfonos graban con cuadros variables),
    /// que es lo que necesitan los fundidos para caer en el segundo justo. Más de 30 fps se divide por el menor
    /// entero que lo deja en 30 o menos (60 → 30, 50 → 25, 120 → 30): se descartan cuadros parejos y el movimiento
    /// sigue fluido. Null si ffprobe no informa los fps (no se toca lo que no se sabe).
    /// </summary>
    private static string? OutputFrameRate(StreamInfo stream)
    {
        if (stream.FrameRate is not var (numerator, denominator))
        {
            return null;
        }

        var cap = (long)MaxFramesPerSecond * denominator;
        var divisor = numerator <= cap ? 1 : (numerator + cap - 1) / cap;
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
            throw new VideoProcessingException(MessageKeys.VideoProcessingTimedOut);
        }

        if (result.ExitCode != 0)
        {
            logger.LogWarning("ffmpeg terminó con código {ExitCode}: {Error}", result.ExitCode, Tail(result.Error));
            throw new VideoProcessingException(MessageKeys.VideoProcessingFailed);
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

    // Al milisegundo, con punto decimal: es el formato de tiempos que entienden ffmpeg y sus filtros.
    private static string Seconds(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

    private sealed record StreamInfo(int Width, int Height, double DurationSeconds, (long Numerator, long Denominator)? FrameRate);
}
