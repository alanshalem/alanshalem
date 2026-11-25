using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>
/// SHA-256 del archivo original, en hexadecimal en minúsculas. Identifica un archivo subido (mismo contenido = mismo
/// asset) y termina siendo una carpeta en disco, así que validarlo garantiza que nada se escribe fuera de /media.
/// </summary>
internal static partial class ContentHash
{
    public const int Length = 64;

    // Se genera en el servidor, nunca lo escribe el usuario: un valor inválido es un error de programación.
    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex Pattern();

    public static void EnsureValid(string hash)
    {
        if (!Pattern().IsMatch(hash))
        {
            throw new ArgumentException("El hash debe ser un SHA-256 en hexadecimal en minúsculas.", nameof(hash));
        }
    }
}
