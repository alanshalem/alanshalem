using Blog.Api.Security;
using Blog.Application.Media;

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

    [Theory]
    [InlineData(new byte[] { 0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00 })]
    [InlineData(new byte[] { 0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08 })]
    public void Detects_tiff_in_both_byte_orders(byte[] header) =>
        Assert.Equal("tif", ImageSniffer.DetectExtension(header));

    // SVG is accepted only to be rasterized: the pipeline stores AVIF and WebP, never the SVG itself.
    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")]
    [InlineData("﻿<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- Created with Inkscape -->\n<svg\n width=\"10\"/>")]
    [InlineData("<?xml version=\"1.0\"?><!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\"><svg>")]
    public void Detects_svg_after_its_optional_bom_prolog_comments_and_doctype(string text) =>
        Assert.Equal("svg", ImageSniffer.DetectExtension(System.Text.Encoding.UTF8.GetBytes(text)));

    // Entity declarations ("billion laughs") and internal DTD subsets are never handed to the XML parser.
    [Theory]
    [InlineData("<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY a \"aaaa\">]><svg>&a;</svg>")]
    [InlineData("<!DOCTYPE svg [ ]><svg></svg>")]
    [InlineData("<svg><!ENTITY a \"x\"></svg>")]
    public void Rejects_svg_that_declares_entities_or_an_internal_dtd(string text) =>
        Assert.Null(ImageSniffer.DetectExtension(System.Text.Encoding.UTF8.GetBytes(text)));

    [Fact]
    public void Rejects_html_text_and_empty_input()
    {
        Assert.Null(ImageSniffer.DetectExtension("<html><script>alert(1)</script>"u8));
        Assert.Null(ImageSniffer.DetectExtension("<svgfoo>"u8));
        Assert.Null(ImageSniffer.DetectExtension("<!-- <svg> in a comment only -->"u8));
        Assert.Null(ImageSniffer.DetectExtension("BMW is a car"u8));
        Assert.Null(ImageSniffer.DetectExtension([]));
    }

    // Formats recognized by their magic bytes that this server's libvips cannot decode: the upload names them.
    [Theory]
    [InlineData("\0\0\0\u0018ftypheic\0\0\0\0mif1heic", "HEIC")]
    [InlineData("\0\0\0\u0018ftypmif1\0\0\0\0mif1heic", "HEIC")]
    [InlineData("\0\0\0\u0018ftypheix\0\0\0\0mif1heix", "HEIC")]
    [InlineData("\0\0\0\u0014ftypmsf1\0\0\0\0hevc", "HEIC")]
    [InlineData("BMF\0\0\0\0\0\0\06\0\0\0(\0\0\0", "BMP")]
    [InlineData("\0\0\u0001\0\u0001\0\u0010\u0010", "ICO")]
    [InlineData("ÿ\nú\u0007", "JPEG XL")]
    [InlineData("\0\0\0\u000CJXL \r\n\u0087\n", "JPEG XL")]
    public void Names_formats_the_server_cannot_decode(string latin1, string name)
    {
        var header = System.Text.Encoding.Latin1.GetBytes(latin1);

        Assert.Null(ImageSniffer.DetectExtension(header));
        Assert.Equal(name, ImageSniffer.UndecodableFormatName(header));
    }

    [Fact]
    public void Does_not_name_decodable_or_unknown_input()
    {
        Assert.Null(ImageSniffer.UndecodableFormatName([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]));
        Assert.Null(ImageSniffer.UndecodableFormatName("\0\0\0\u001cftypavif\0\0\0\0"u8));
        Assert.Null(ImageSniffer.UndecodableFormatName("BMW is a car"u8));
        Assert.Null(ImageSniffer.UndecodableFormatName("not an image"u8));
        Assert.Null(ImageSniffer.UndecodableFormatName([]));
    }
}

public class Pbkdf2PasswordHasherTests
{
    // Few iterations: this tests the logic, not the strength (which is 600,000 in production).
    private const int FastIterations = 1_000;

    [Theory]
    [InlineData("", false)]
    [InlineData("bcrypt$10$abc", false)]
    [InlineData("pbkdf2-sha256", false)]
    [InlineData("pbkdf2-sha256$1000$c2FsdA==$aGFzaA==", true)]
    public void IsHash_recognizes_the_stored_format_that_the_api_requires_to_start(string stored, bool expected) =>
        Assert.Equal(expected, Pbkdf2PasswordHasher.IsHash(stored));

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
        Assert.False(Pbkdf2PasswordHasher.Verify("anything", stored));
}
