using Blog.Api.Cli;
using Blog.Api.Security;

namespace Blog.Tests;

/// <summary>
/// El modo hash-password: pide una contraseña de al menos 12 caracteres e imprime solo el hash en la salida estándar.
/// En una consola la lee sin mostrarla; con la entrada redirigida (echo pw | ...) la lee como una línea, para scripts.
/// </summary>
public class HashPasswordCommandTests
{
    [Fact]
    public async Task With_redirected_input_it_prints_only_a_hash_that_verifies_the_password()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("una contraseña larga\n"), output, error);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("una contraseña larga", output.ToString().Trim()));
        Assert.DoesNotContain("una contraseña larga", output.ToString() + error.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("corta")]
    [InlineData("once letras")]
    public async Task A_password_under_12_characters_is_rejected_with_exit_1_and_no_hash(string password)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader(password + "\n"), output, error);

        Assert.Equal((1, string.Empty), (exitCode, output.ToString()));
        Assert.Contains("La contraseña tiene que tener al menos 12 caracteres.", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Exactly_12_characters_is_enough()
    {
        using var output = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("doce letras!\n"), output, TextWriter.Null);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("doce letras!", output.ToString().Trim()));
    }

    [Fact]
    public async Task On_a_console_it_reads_the_password_without_echoing_it_and_backspace_erases()
    {
        // "secreto largo X", borra la X con Backspace, y Enter.
        var keys = new Queue<ConsoleKeyInfo>("secreto largoX".Select(Key));
        keys.Enqueue(new ConsoleKeyInfo('\b', ConsoleKey.Backspace, false, false, false));
        keys.Enqueue(new ConsoleKeyInfo('\r', ConsoleKey.Enter, false, false, false));
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], TextReader.Null, output, error, keys.Dequeue);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("secreto largo", output.ToString().Trim()));
        Assert.Equal("Contraseña: " + Environment.NewLine, error.ToString());
    }

    private static ConsoleKeyInfo Key(char character) => new(character, ConsoleKey.A, shift: false, alt: false, control: false);
}
