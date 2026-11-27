using System.Text;
using Blog.Api.Security;

namespace Blog.Api.Cli;

/// <summary>Imprime el hash PBKDF2 de la contraseña del admin (el valor de Admin__PasswordHash).</summary>
internal static class HashPasswordCommand
{
    /// <summary>Lo mínimo para una contraseña que protege un panel expuesto a internet (el login además tiene rate limit).</summary>
    public const int MinLength = 12;

    /// <param name="readHiddenKey">
    /// En una consola, lee tecla por tecla sin mostrarlas (Console.ReadKey interceptado). Null si la entrada está
    /// redirigida (echo pw | ...): entonces se lee una línea de <paramref name="input"/>, como en un script.
    /// </param>
    public static int Run(TextReader input, TextWriter output, TextWriter error, Func<ConsoleKeyInfo>? readHiddenKey)
    {
        // El pedido va a la salida de errores: así la salida estándar es solo el hash (se puede redirigir o capturar).
        error.Write("Contraseña: ");
        var password = readHiddenKey is null ? input.ReadLine() ?? string.Empty : ReadHidden(readHiddenKey, error);
        if (password.Length < MinLength)
        {
            error.WriteLine($"La contraseña tiene que tener al menos {MinLength} caracteres.");
            return 1;
        }

        output.WriteLine(Pbkdf2PasswordHasher.Hash(password));
        return 0;
    }

    // Sin eco: nada de lo que se escribe aparece en la pantalla (ni asteriscos, que dirían el largo). Backspace borra.
    private static string ReadHidden(Func<ConsoleKeyInfo> readKey, TextWriter error)
    {
        var password = new StringBuilder();
        for (var pressed = readKey(); pressed.Key != ConsoleKey.Enter; pressed = readKey())
        {
            if (pressed.Key == ConsoleKey.Backspace)
            {
                password.Length = Math.Max(0, password.Length - 1);
            }
            else if (!char.IsControl(pressed.KeyChar))
            {
                password.Append(pressed.KeyChar);
            }
        }

        error.WriteLine();
        return password.ToString();
    }
}
