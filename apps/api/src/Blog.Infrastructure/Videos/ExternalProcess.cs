using System.ComponentModel;
using System.Diagnostics;

namespace Blog.Infrastructure.Videos;

/// <summary>
/// Corre ffmpeg/ffprobe con una lista de argumentos (nunca un string para una shell: un nombre de archivo no puede
/// inyectar opciones ni comandos), con prioridad baja y un tiempo máximo.
/// </summary>
internal static class ExternalProcess
{
    public sealed record Result(int ExitCode, string Output, string Error);

    /// <exception cref="TimeoutException">Si se pasa del tiempo máximo (el proceso se mata con todos sus hijos).</exception>
    /// <exception cref="Win32Exception">Si el ejecutable no existe: es una falla del servidor, no del archivo.</exception>
    public static async Task<Result> RunAsync(
        string fileName, IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"No se pudo iniciar {fileName}.");
        LowerPriority(process);

        // Las dos salidas se leen en paralelo: si una se llena sin que nadie la lea, el proceso se bloquea.
        var output = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var error = process.StandardError.ReadToEndAsync(CancellationToken.None);

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(deadline.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException($"{Path.GetFileName(fileName)} superó {timeout.TotalMinutes:0.#} min.");
        }

        return new Result(process.ExitCode, await output, await error);
    }

    // Prioridad baja: la API, el sitio y las otras apps del VPS siguen respondiendo mientras se codifica. Se baja
    // apenas arranca (hay un instante a prioridad normal, irrelevante frente a minutos de codificación); si el
    // proceso ya terminó o el sistema no lo permite, se sigue igual.
    private static void LowerPriority(Process process)
    {
        try
        {
            process.PriorityClass = ProcessPriorityClass.BelowNormal;
        }
        catch (Exception exception) when (exception is InvalidOperationException or Win32Exception)
        {
        }
    }
}
