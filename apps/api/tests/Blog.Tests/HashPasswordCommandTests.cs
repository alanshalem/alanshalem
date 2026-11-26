using Blog.Api.Cli;
using Blog.Infrastructure.Security;

namespace Blog.Tests;

/// <summary>El modo hash-password: lee la contraseña de la entrada e imprime solo el hash en la salida estándar.</summary>
public class HashPasswordCommandTests
{
    [Fact]
    public async Task Hash_password_prints_only_a_hash_that_verifies_the_password_read_from_the_input()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("una contraseña larga\n"), output, error);

        Assert.Equal(0, exitCode);
        var hash = output.ToString().Trim();
        Assert.True(Pbkdf2PasswordHasher.Verify("una contraseña larga", hash));
        Assert.DoesNotContain("una contraseña larga", output.ToString() + error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Hash_password_rejects_an_empty_password_with_exit_1()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("\n"), output, error);

        Assert.Equal((1, string.Empty), (exitCode, output.ToString()));
        Assert.Contains("La contraseña no puede estar vacía.", error.ToString(), StringComparison.Ordinal);
    }
}
