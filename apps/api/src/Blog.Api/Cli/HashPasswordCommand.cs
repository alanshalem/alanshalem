using System.Text;
using Blog.Api.Security;

namespace Blog.Api.Cli;

/// <summary>Prints the PBKDF2 hash of the admin password (the value of Admin__PasswordHash).</summary>
internal static class HashPasswordCommand
{
    /// <summary>The minimum for a password protecting a panel exposed to the internet (the login is also rate limited).</summary>
    public const int MinLength = 12;

    /// <param name="readHiddenKey">
    /// In a console, reads key by key without showing them (intercepted Console.ReadKey). Null if the input is
    /// redirected (echo pw | ...): then one line of <paramref name="input"/> is read, as in a script.
    /// </param>
    public static int Run(TextReader input, TextWriter output, TextWriter error, Func<ConsoleKeyInfo>? readHiddenKey)
    {
        // The prompt goes to standard error: this way standard output is only the hash (it can be redirected or captured).
        error.Write("Password: ");
        var password = readHiddenKey is null ? input.ReadLine() ?? string.Empty : ReadHidden(readHiddenKey, error);
        if (password.Length < MinLength)
        {
            error.WriteLine($"The password must be at least {MinLength} characters long.");
            return 1;
        }

        output.WriteLine(Pbkdf2PasswordHasher.Hash(password));
        return 0;
    }

    // No echo: nothing typed shows on the screen (not even asterisks, which would reveal the length). Backspace deletes.
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
