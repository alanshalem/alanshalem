using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Blog.Tests;

/// <summary>
/// Videos para las pruebas. Los falsos son bytes con cabecera MP4 (para el ffmpeg simulado); los reales se generan con
/// ffmpeg (patrón de prueba + tono de audio), así no hay archivos binarios en el repo.
/// </summary>
internal static class TestVideos
{
    /// <summary>Caja ftyp de un MP4 ("isom"): lo mínimo para pasar la verificación de magic bytes.</summary>
    public static readonly byte[] FtypHeader = [0x00, 0x00, 0x00, 0x18, .. "ftypisom"u8];

    /// <summary>"Video" falso: cabecera MP4 + contenido propio (contenidos distintos = hashes distintos).</summary>
    public static byte[] Fake(string content) => [.. FtypHeader, .. System.Text.Encoding.UTF8.GetBytes(content)];

    /// <summary>Clip real H.264 + AAC generado con ffmpeg en el archivo indicado.</summary>
    public static async Task<string> GenerateAsync(
        string path, int width, int height, double seconds, int fps = 30, bool audio = true, int? displayRotation = null)
    {
        List<string> arguments = ["-hide_banner", "-loglevel", "error", "-y"];
        if (displayRotation is { } rotation)
        {
            // Como un teléfono: los píxeles se guardan acostados y una matriz de rotación dice cómo mostrarlos.
            arguments.AddRange(["-display_rotation", rotation.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        }

        arguments.AddRange(["-f", "lavfi", "-i", $"testsrc2=size={width}x{height}:rate={fps}"]);
        if (audio)
        {
            arguments.AddRange(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]);
        }

        arguments.AddRange(["-t", seconds.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
        if (audio)
        {
            arguments.AddRange(["-c:a", "aac", "-shortest"]);
        }

        arguments.Add(path);
        await RunAsync("ffmpeg", arguments);
        return path;
    }

    /// <summary>
    /// Una imagen fija que se desplaza 2 px por cuadro (30 fps): cuadros vecinos casi iguales y cuadros lejanos bien
    /// distintos. Sirve para medir saltos (un corte se nota, un empalme sin salto no) y en qué cuadro empieza un recorte.
    /// </summary>
    public static async Task<string> GeneratePanAsync(string path, int width, int height, double seconds)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"testsrc=size={width}x{height}:rate=1:duration=1",
            "-filter_complex", $"[0]scale={width * 3}:{height},loop=-1:1,fps=30,setpts=N/30/TB,crop={width}:{height}:t*60:0,format=yuv420p",
            "-t", Invariant(seconds), "-c:v", "libx264", "-preset", "ultrafast", path,
        ]);
        return path;
    }

    /// <summary>
    /// Gris oscuro liso hasta <paramref name="cutAtSeconds"/> y blanco después: un cambio de escena brusco en un segundo
    /// conocido, para saber de qué lado salió un cuadro con solo medir su luminancia.
    /// </summary>
    public static async Task<string> GenerateHardCutAsync(string path, int width, int height, double cutAtSeconds, double seconds, int fps)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"color=c=0x202020:size={width}x{height}:rate={fps}:duration={Invariant(cutAtSeconds)}",
            "-f", "lavfi", "-i", $"color=c=white:size={width}x{height}:rate={fps}:duration={Invariant(seconds - cutAtSeconds)}",
            "-filter_complex", "[0][1]concat=n=2:v=1:a=0,format=yuv420p",
            "-c:v", "libx264", "-preset", "ultrafast", path,
        ]);
        return path;
    }

    /// <summary>Patrón de prueba con ruido fuerte que cambia en cada cuadro: el peor caso para el peso (sin el techo, explota).</summary>
    public static async Task<string> GenerateNoisyAsync(string path, int width, int height, double seconds)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"testsrc2=size={width}x{height}:rate=30", "-vf", "noise=alls=40:allf=t+u,format=yuv420p",
            "-t", Invariant(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", path,
        ]);
        return path;
    }

    /// <summary>Cuántos cuadros tiene el video (decodificándolo entero, no lo que dice la cabecera).</summary>
    public static async Task<int> FrameCountAsync(string path)
    {
        var (output, _) = await RunAsync("ffprobe",
            ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]);
        return int.Parse(output.Trim(), CultureInfo.InvariantCulture);
    }

    /// <summary>PSNR (dB) entre un cuadro de un video y uno de otro (o del mismo): más alto = más parecidos.</summary>
    public static async Task<double> PsnrAsync(string first, int firstFrame, string second, int secondFrame)
    {
        var (_, log) = await RunAsync("ffmpeg",
        [
            "-hide_banner", "-nostdin", "-i", first, "-i", second, "-filter_complex",
            $"[0:v]select=eq(n\\,{firstFrame}),setpts=0[a];[1:v]select=eq(n\\,{secondFrame}),setpts=0[b];[a][b]psnr", "-f", "null", "-",
        ]);
        var average = Regex.Match(log, @"PSNR .* average:(?<value>[0-9.]+|inf)").Groups["value"].Value;
        return average == "inf" ? double.PositiveInfinity : double.Parse(average, CultureInfo.InvariantCulture);
    }

    /// <summary>Luminancia media de un cuadro (0-255; el negro de video es 16).</summary>
    public static async Task<double> MeanLumaAsync(string path, int frame)
    {
        var (_, log) = await RunAsync("ffmpeg",
            ["-hide_banner", "-nostdin", "-i", path, "-vf", $"select=eq(n\\,{frame}),signalstats,metadata=print", "-f", "null", "-"]);
        return double.Parse(Regex.Match(log, @"lavfi\.signalstats\.YAVG=(?<value>[0-9.]+)").Groups["value"].Value, CultureInfo.InvariantCulture);
    }

    /// <summary>Lo que ffprobe ve en un archivo: los streams (tipo, códec, perfil, tamaño, fps) y la duración.</summary>
    public static async Task<JsonElement> ProbeAsync(string path)
    {
        var (json, _) = await RunAsync("ffprobe",
        [
            "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate:format=duration", "-of", "json", path,
        ]);
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private static string Invariant(double value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>La salida estándar y el log (stderr): ahí escriben psnr y signalstats sus mediciones.</summary>
    private static async Task<(string Output, string Log)> RunAsync(string fileName, IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo)!;
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{fileName} falló ({process.ExitCode}): {await error}");
        }

        return (await output, await error);
    }
}
