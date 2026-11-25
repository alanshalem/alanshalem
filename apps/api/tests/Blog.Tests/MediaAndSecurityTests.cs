using Blog.Application.Media;
using Blog.Infrastructure.Security;

namespace Blog.Tests;

public class ImageSnifferTests
{
    [Fact]
    public void Detects_png() =>
        Assert.Equal("png", ImageSniffer.DetectExtension([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]));

    [Fact]
    public void Detects_jpeg() =>
        Assert.Equal("jpg", ImageSniffer.DetectExtension([0xFF, 0xD8, 0xFF, 0xE0, 0x00]));

    [Fact]
    public void Detects_gif() =>
        Assert.Equal("gif", ImageSniffer.DetectExtension("GIF89a...."u8));

    [Fact]
    public void Detects_webp() =>
        Assert.Equal("webp", ImageSniffer.DetectExtension("RIFF\0\0\0\0WEBPVP8 "u8));

    [Fact]
    public void Detects_avif() =>
        Assert.Equal("avif", ImageSniffer.DetectExtension("\0\0\0\u001cftypavif\0\0\0\0"u8));

    [Fact]
    public void Rejects_svg_because_it_can_carry_scripts() =>
        Assert.Null(ImageSniffer.DetectExtension("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"u8));

    [Fact]
    public void Rejects_html_and_empty_input()
    {
        Assert.Null(ImageSniffer.DetectExtension("<html><script>alert(1)</script>"u8));
        Assert.Null(ImageSniffer.DetectExtension([]));
    }
}

public class Pbkdf2PasswordHasherTests
{
    // Pocas iteraciones: acá se prueba la lógica, no la fuerza (que son 600.000 en producción).
    private const int FastIterations = 1_000;

    [Fact]
    public void Verify_accepts_the_right_password_and_rejects_a_wrong_one()
    {
        var stored = Pbkdf2PasswordHasher.Hash("correcta", FastIterations);

        Assert.True(Pbkdf2PasswordHasher.Verify("correcta", stored));
        Assert.False(Pbkdf2PasswordHasher.Verify("incorrecta", stored));
        Assert.False(Pbkdf2PasswordHasher.Verify(string.Empty, stored));
    }

    [Fact]
    public void Hash_uses_a_different_salt_every_time()
    {
        Assert.NotEqual(
            Pbkdf2PasswordHasher.Hash("igual", FastIterations),
            Pbkdf2PasswordHasher.Hash("igual", FastIterations));
    }

    [Theory]
    [InlineData("")]
    [InlineData("texto-plano")]
    [InlineData("pbkdf2-sha256$abc$AAAA$AAAA")]
    [InlineData("otro-algoritmo$1000$AAAA$AAAA")]
    [InlineData("pbkdf2-sha256$1000$no-es-base64!$AAAA")]
    public void Verify_returns_false_for_malformed_hashes_instead_of_throwing(string stored) =>
        Assert.False(Pbkdf2PasswordHasher.Verify("lo-que-sea", stored));
}
