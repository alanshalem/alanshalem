using System.Security.Cryptography;

namespace Blog.Api.Security;

/// <summary>
/// Password hashing with PBKDF2-SHA256 (built into .NET, no extra packages).
/// Stored format: pbkdf2-sha256$iterations$salt(base64)$hash(base64) — the iterations travel with the hash, so they can
/// be raised later without invalidating old hashes.
/// </summary>
internal static class Pbkdf2PasswordHasher
{
    private const string Prefix = "pbkdf2-sha256";
    private const int DefaultIterations = 600_000; // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
    private const int SaltSize = 16;
    private const int HashSize = 32;

    /// <summary>Whether it has the shape of a hash of this format (to validate the configuration on start).</summary>
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
                return false; // an empty hash would accept any password
            }

            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);

            // Constant-time comparison: it does not leak how many bytes match.
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
