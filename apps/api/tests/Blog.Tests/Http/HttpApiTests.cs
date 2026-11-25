using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace Blog.Tests.Http;

/// <summary>
/// El contrato HTTP tal como lo ven el admin y el builder: rutas, códigos de estado, cookie de sesión, cabecera
/// anti-CSRF, token del builder y mensajes en español. Lo de adentro (casos de uso, pipeline) se prueba aparte.
/// </summary>
[Collection(ApiCollection.Name)]
public class HttpApiTests(ApiFactory api)
{
    [Theory]
    [InlineData("/api/auth/me")]
    [InlineData("/api/admin/posts")]
    [InlineData("/api/admin/settings")]
    [InlineData("/api/admin/hero-images")]
    [InlineData("/api/admin/media/videos/0198f3a0-0000-7000-8000-000000000000")]
    public async Task Admin_routes_without_a_session_are_401(string url)
    {
        using var client = api.CreateHttpsClient();

        using var response = await client.GetAsync(url);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("POST", "/api/auth/login")]
    [InlineData("POST", "/api/admin/hero-images")]
    [InlineData("PUT", "/api/admin/settings")]
    [InlineData("DELETE", "/api/admin/hero-images/0198f3a0-0000-7000-8000-000000000000")]
    public async Task Mutations_without_the_csrf_header_are_403_even_with_a_session(string method, string url)
    {
        var admin = await api.AdminClientAsync();

        using var response = await admin.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = ApiFactory.JsonContent(new { }) });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Login_sets_a_secure_http_only_strict_session_cookie_and_a_wrong_password_is_401()
    {
        using var client = api.CreateHttpsClient();

        using var wrong = await client.SendAsync(
            ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", ApiFactory.JsonContent(new { password = "otra" })));
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.False(wrong.Headers.Contains("Set-Cookie"));

        using var login = await client.SendAsync(
            ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", ApiFactory.JsonContent(new { password = ApiFactory.Password })));
        Assert.Equal(HttpStatusCode.NoContent, login.StatusCode);
        var cookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith("__Host-admin=", cookie, StringComparison.Ordinal);
        Assert.Contains("path=/", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);

        using var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Uploading_an_image_returns_the_media_asset_with_its_url()
    {
        var admin = await api.AdminClientAsync();
        var png = Png(1920, 1080);
        var hash = Convert.ToHexStringLower(SHA256.HashData(png));

        var asset = await UploadImageAsync(admin, png);

        Assert.Equal($"/media/{hash}/1600.webp", asset.GetProperty("url").GetString());
        Assert.Equal((1920, 1080), (asset.GetProperty("width").GetInt32(), asset.GetProperty("height").GetInt32()));
        Assert.Matches("^#[0-9a-f]{6}$", asset.GetProperty("color").GetString());
        Assert.StartsWith("data:image/webp;base64,", asset.GetProperty("placeholder").GetString(), StringComparison.Ordinal);
        Assert.Equal(
            ["avif:640", "avif:1024", "avif:1600", "webp:640", "webp:1024", "webp:1600"],
            asset.GetProperty("variants").EnumerateArray().Select(variant => $"{variant.GetProperty("format").GetString()}:{variant.GetProperty("width").GetInt32()}"));
    }

    [Fact]
    public async Task Hero_images_crud_answers_201_200_204_404_and_400_with_the_spanish_detail()
    {
        var admin = await api.AdminClientAsync();
        var media = await UploadImageAsync(admin, Png(1920, 1080, seed: 1));
        var mediaId = media.GetProperty("id").GetGuid();
        var buildsBefore = api.Build.Requests;

        using var created = await admin.SendAsync(ApiFactory.Mutation(
            HttpMethod.Post, "/api/admin/hero-images", ApiFactory.JsonContent(new { mediaId, alt = "Nebulosa", credit = "Foto: Ana" })));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var image = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = image.GetProperty("id").GetGuid();
        Assert.Equal($"/api/admin/hero-images/{id}", created.Headers.Location?.OriginalString);
        Assert.Equal(mediaId, image.GetProperty("media").GetProperty("id").GetGuid());
        Assert.Equal(JsonValueKind.Null, image.GetProperty("video").ValueKind);

        using var updated = await admin.SendAsync(ApiFactory.Mutation(
            HttpMethod.Put, $"/api/admin/hero-images/{id}", ApiFactory.JsonContent(new { alt = "Orión", credit = (string?)null })));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal("Orión", (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("alt").GetString());

        using var invalid = await admin.SendAsync(ApiFactory.Mutation(
            HttpMethod.Post, "/api/admin/hero-images", ApiFactory.JsonContent(new { mediaId, alt = "  " })));
        await AssertProblemAsync(invalid, HttpStatusCode.BadRequest, "El texto alternativo es obligatorio.");

        using var deleted = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Delete, $"/api/admin/hero-images/{id}"));
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        using var deletedAgain = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Delete, $"/api/admin/hero-images/{id}"));
        await AssertProblemAsync(deletedAgain, HttpStatusCode.NotFound, "La foto del hero no existe.");

        // Alta, edición y baja piden regenerar el sitio; lo rechazado no.
        Assert.Equal(buildsBefore + 3, api.Build.Requests);
    }

    [Theory]
    [InlineData("/api/internal/posts")]
    [InlineData("/api/internal/settings")]
    [InlineData("/api/internal/media")]
    [InlineData("/api/internal/hero-images")]
    public async Task Internal_routes_need_the_builder_token(string url)
    {
        using var client = api.CreateHttpsClient();

        using var missing = await client.GetAsync(url);
        using var wrong = await client.SendAsync(WithBearer(url, ApiFactory.BuilderToken + "x"));
        using var right = await client.SendAsync(WithBearer(url, ApiFactory.BuilderToken));

        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.OK, right.StatusCode);
        Assert.Equal("application/json", right.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("texto", null, null, "Formato no soportado. Subí un video MP4, MOV, WebM o MKV.")]
    [InlineData("mp4", "fade", "fast", "Fundido no válido: tiene que ser loop, black o none.")]
    [InlineData("mp4", "trimStart", "2,5", "El inicio del recorte no es un número válido: usá segundos con punto decimal (ej. 2.5).")]
    [InlineData("mp4", "trimEnd", "16", "El fin del recorte (16 s) pasa el final del video, que dura 10 s.")]
    public async Task A_video_upload_that_is_not_a_video_or_has_a_bad_edit_is_400_with_the_spanish_detail(
        string kind, string? field, string? value, string expectedDetail)
    {
        var admin = await api.AdminClientAsync();
        using var form = new MultipartFormDataContent();
        var content = kind == "mp4" ? TestVideos.Fake("http") : "esto no es un video"u8.ToArray();
        form.Add(new ByteArrayContent(content) { Headers = { ContentType = new MediaTypeHeaderValue("video/mp4") } }, "file", "clip.mp4");
        if (field is not null)
        {
            form.Add(new StringContent(value!), field);
        }

        using var response = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/media/videos", form));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, expectedDetail);
        Assert.Equal(0, api.Transcoder.Transcodes);
    }

    [Fact]
    public async Task Media_files_are_served_only_in_development_and_never_outside_the_media_folder()
    {
        var relativePath = "0123456789abcdef/640.webp";
        var file = Path.Combine(api.MediaDirectory, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        byte[] bytes = [1, 2, 3, 4];
        await File.WriteAllBytesAsync(file, bytes);
        using var production = api.CreateHttpsClient();
        using var development = api.CreateHttpsClient(api.Development);

        using var inProduction = await production.GetAsync($"/media/{relativePath}");
        using var inDevelopment = await development.GetAsync($"/media/{relativePath}");
        // HttpClient resolvería el %2e%2e en el cliente (al servidor llegaría /blog.db), así que la ruta se arma a mano:
        // tal cual (%2e%2e) y ya decodificada sin normalizar (..), lo peor que podría entregar un servidor.
        var outsideName = Path.GetFileName(api.OutsideMediaFile);
        var escapes = new List<int>();
        foreach (var path in new[] { $"/media/%2e%2e/{outsideName}", $"/media/../{outsideName}" })
        {
            var context = await api.Development.Server.SendAsync(request =>
            {
                request.Request.Method = HttpMethods.Get;
                request.Request.Path = path;
            });
            escapes.Add(context.Response.StatusCode);
        }

        Assert.Equal(HttpStatusCode.NotFound, inProduction.StatusCode);
        Assert.Equal(HttpStatusCode.OK, inDevelopment.StatusCode);
        Assert.Equal(bytes, await inDevelopment.Content.ReadAsByteArrayAsync());
        Assert.True(File.Exists(api.OutsideMediaFile));
        Assert.Equal([StatusCodes.Status404NotFound, StatusCodes.Status404NotFound], escapes);
    }

    private static byte[] Png(int width, int height, int seed = 0)
    {
        using var gradient = TestImages.Gradient(width, height);
        using var shifted = gradient + seed;
        using var image = shifted.Cast(NetVips.Enums.BandFormat.Uchar);
        return TestImages.Png(image);
    }

    private static async Task<JsonElement> UploadImageAsync(HttpClient admin, byte[] png)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(png) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } }, "file", "foto.png");

        using var response = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/media", form));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static HttpRequestMessage WithBearer(string url, string token) =>
        new(HttpMethod.Get, url) { Headers = { Authorization = new AuthenticationHeaderValue("Bearer", token) } };

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string detail)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(detail, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
    }
}
