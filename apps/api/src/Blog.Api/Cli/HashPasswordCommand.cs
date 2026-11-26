using Blog.Infrastructure.Security;

namespace Blog.Api.Cli;

/// <summary>Imprime el hash PBKDF2 de la contraseña del admin (el valor de Admin__PasswordHash).</summary>
internal static class HashPasswordCommand
{
    public static int Run(TextReader input, TextWriter output, TextWriter error)
    {
        // El pedido va a la salida de errores: así la salida estándar es solo el hash (se puede redirigir o capturar).
        error.Write("Contraseña: ");
        var password = input.ReadLine();
        if (string.IsNullOrEmpty(password))
        {
            error.WriteLine("La contraseña no puede estar vacía.");
            return 1;
        }

        output.WriteLine(Pbkdf2PasswordHasher.Hash(password));
        return 0;
    }
}
