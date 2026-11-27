using Blog.Api.Cli;
using Blog.Api.Security;

namespace Blog.Tests;

/// <summary>
/// The hash-password mode: asks for a password of at least 12 characters and prints only the hash on standard output.
/// In a console it reads it without showing it; with redirected input (echo pw | ...) it reads it as a line, for scripts.
/// </summary>
public class HashPasswordCommandTests
{
    [Fact]
    public async Task With_redirected_input_it_prints_only_a_hash_that_verifies_the_password()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("a long password\n"), output, error);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("a long password", output.ToString().Trim()));
        Assert.DoesNotContain("a long password", output.ToString() + error.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("eleven char")]
    public async Task A_password_under_12_characters_is_rejected_with_exit_1_and_no_hash(string password)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader(password + "\n"), output, error);

        Assert.Equal((1, string.Empty), (exitCode, output.ToString()));
        Assert.Contains("The password must be at least 12 characters long.", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Exactly_12_characters_is_enough()
    {
        using var output = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], new StringReader("twelve chars\n"), output, TextWriter.Null);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("twelve chars", output.ToString().Trim()));
    }

    [Fact]
    public async Task On_a_console_it_reads_the_password_without_echoing_it_and_backspace_erases()
    {
        // Types "a long secretX", erases the X with Backspace, and Enter.
        var keys = new Queue<ConsoleKeyInfo>("a long secretX".Select(Key));
        keys.Enqueue(new ConsoleKeyInfo('\b', ConsoleKey.Backspace, false, false, false));
        keys.Enqueue(new ConsoleKeyInfo('\r', ConsoleKey.Enter, false, false, false));
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["hash-password"], TextReader.Null, output, error, keys.Dequeue);

        Assert.Equal(0, exitCode);
        Assert.True(Pbkdf2PasswordHasher.Verify("a long secret", output.ToString().Trim()));
        Assert.Equal("Password: " + Environment.NewLine, error.ToString());
    }

    private static ConsoleKeyInfo Key(char character) => new(character, ConsoleKey.A, shift: false, alt: false, control: false);
}
