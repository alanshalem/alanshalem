using System.Security.Cryptography;

namespace Blog.Infrastructure.Security;

/// <summary>
/// Hash de contraseña con PBKDF2-SHA256 (viene en .NET, sin paquetes extra).
/// Formato guardado: pbkdf2-sha256$iteraciones$salt(base64)$hash(base64) — las iteraciones viajan con el hash,
/// así se pueden subir más adelante sin invalidar hashes viejos.
/// </summary>
public static class Pbkdf2PasswordHasher
{
    private const string Prefix = "pbkdf2-sha256";
    private const int DefaultIterations = 600_000; // recomendación OWASP 2023 para PBKDF2-HMAC-SHA256
    private const int SaltSize = 16;
    private const int HashSize = 32;

    /// <summary>Si tiene la forma de un hash de este formato (para validar la configuración al arrancar).</summary>
    public static bool IsHash(string stored) => stored.StartsWith(Prefix + "$", StringComparison.Ordinal);

    public static string Hash(string password, int iterations = DefaultIterations)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, HashSize);
        return $"{Prefix}${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], out var iterations) || iterations <= 0)
        {
            return false;
        }

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            if (salt.Length == 0 || expected.Length == 0)
            {
                return false; // un hash vacío aceptaría cualquier contraseña
            }

            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);

            // Comparación en tiempo constante: no filtra cuántos bytes coinciden.
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
