using System.Diagnostics;
using System.Text.Json;

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

    /// <summary>Lo que ffprobe ve en un archivo: los streams (tipo, códec, perfil, tamaño, fps) y la duración.</summary>
    public static async Task<JsonElement> ProbeAsync(string path)
    {
        var json = await RunAsync("ffprobe",
        [
            "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate:format=duration", "-of", "json", path,
        ]);
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private static async Task<string> RunAsync(string fileName, IReadOnlyList<string> arguments)
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

        return await output;
    }
}
