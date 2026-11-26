using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests.Http;

/// <summary>
/// Los errores de la API en el idioma del admin: la primera preferencia de Accept-Language decide (en → inglés; lo
/// demás, o sin cabecera, español, como la redirección de Caddy). La forma del JSON no cambia y suma un "code" estable.
/// </summary>
[Collection(ApiCollection.Name)]
public class LocalizedErrorsHttpTests(ApiFactory api)
{
    private const string AcceptLanguage = "Accept-Language";
    private const string EnglishBrowser = "en-US,en;q=0.9,es;q=0.8";

    [Theory]
    [InlineData(null, "Datos inválidos", "El título es obligatorio.")]
    [InlineData("es-AR,es;q=0.9,en;q=0.8", "Datos inválidos", "El título es obligatorio.")]
    [InlineData("fr-FR, en;q=0.9", "Datos inválidos", "El título es obligatorio.")]
    [InlineData("eng", "Datos inválidos", "El título es obligatorio.")]
    [InlineData(EnglishBrowser, "Invalid data", "The title is required.")]
    [InlineData(" EN", "Invalid data", "The title is required.")]
    public async Task A_validation_error_answers_in_the_first_preferred_language_with_a_stable_code(
        string? acceptLanguage, string title, string detail)
    {
        var admin = await api.AdminClientAsync();
        var request = ApiFactory.Mutation(HttpMethod.Post, "/api/admin/posts", ApiFactory.JsonContent(new { title = " " }));

        using var response = await admin.SendAsync(WithLanguage(request, acceptLanguage));

        var problem = await AssertProblemAsync(response, HttpStatusCode.BadRequest, title, detail, "post.titleRequired");
        Assert.Contains(AcceptLanguage, response.Headers.Vary);
        Assert.Superset(
            new HashSet<string> { "type", "title", "status", "detail", "code" },
            problem.EnumerateObject().Select(property => property.Name).ToHashSet());
    }

    [Fact]
    public async Task Not_found_and_conflict_are_localized_with_their_arguments()
    {
        var admin = await api.AdminClientAsync();
        using var created = await admin.SendAsync(ApiFactory.Mutation(
            HttpMethod.Post, "/api/admin/posts", ApiFactory.JsonContent(new { title = "Idiomas", slug = "errores-por-idioma", body = "x" })));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        HttpRequestMessage Duplicate() => ApiFactory.Mutation(
            HttpMethod.Post, "/api/admin/posts", ApiFactory.JsonContent(new { title = "Otro", slug = "errores-por-idioma", body = "y" }));

        using var conflictEn = await admin.SendAsync(WithLanguage(Duplicate(), EnglishBrowser));
        using var conflictEs = await admin.SendAsync(Duplicate());
        using var notFoundEn = await admin.SendAsync(WithLanguage(new HttpRequestMessage(HttpMethod.Get, $"/api/admin/posts/{Guid.NewGuid()}"), "en"));

        await AssertProblemAsync(
            conflictEn, HttpStatusCode.Conflict, "Conflict", "There is already a post in Spanish with the slug \"errores-por-idioma\".", "post.slugTaken");
        await AssertProblemAsync(
            conflictEs, HttpStatusCode.Conflict, "Conflicto", "Ya existe un post en español con el slug \"errores-por-idioma\".", "post.slugTaken");
        await AssertProblemAsync(notFoundEn, HttpStatusCode.NotFound, "Not found", "The post doesn't exist.", "post.notFound");
    }

    [Theory]
    [InlineData(null, "El fin del recorte (10,55 s) pasa el final del video, que dura 10 s.")]
    [InlineData(EnglishBrowser, "The trim end (10.55 s) goes past the end of the video, which lasts 10 s.")]
    public async Task A_bad_video_edit_writes_its_seconds_as_the_language_does(string? acceptLanguage, string detail)
    {
        var admin = await api.AdminClientAsync();
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(TestVideos.Fake("idioma")) { Headers = { ContentType = new MediaTypeHeaderValue("video/mp4") } }, "file", "clip.mp4");
        form.Add(new StringContent("10.55"), "trimEnd");

        using var response = await admin.SendAsync(WithLanguage(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/media/videos", form), acceptLanguage));

        await AssertProblemAsync(
            response, HttpStatusCode.BadRequest, acceptLanguage is null ? "Datos inválidos" : "Invalid data", detail, "video.trimEndPastVideo");
    }

    [Theory]
    [InlineData(null, "ffmpeg no pudo convertir el video. Probá exportarlo de nuevo como MP4 y volvé a subirlo.")]
    [InlineData(EnglishBrowser, "ffmpeg couldn't convert the video. Try exporting it again as MP4 and upload it again.")]
    public async Task A_failed_video_shows_its_error_in_the_language_of_the_request(string? acceptLanguage, string error)
    {
        // Fábrica propia: procesar videos cambia el contador del ffmpeg simulado que miran otras pruebas.
        await using var own = new ApiFactory();
        var admin = await own.AdminClientAsync();
        var id = await UploadVideoAsync(admin, "FAIL por idioma");

        var video = await WaitUntilFailedAsync(admin, id, acceptLanguage);

        Assert.Equal(error, video.GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_video_failed_before_the_catalog_shows_its_stored_text_as_is()
    {
        await using var own = new ApiFactory();
        var admin = await own.AdminClientAsync();
        var id = await UploadVideoAsync(admin, "FAIL de antes");
        await WaitUntilFailedAsync(admin, id, acceptLanguage: null);
        await using (var scope = own.Services.CreateAsyncScope())
        {
            // Como lo dejaba la versión anterior: el texto en español en la columna, en vez de la clave.
            var updated = await scope.ServiceProvider.GetRequiredService<BlogDbContext>().Database.ExecuteSqlAsync(
                $"UPDATE video_assets SET Error = {"Texto viejo guardado en español."} WHERE Id = {id.ToString().ToUpperInvariant()} COLLATE NOCASE");
            Assert.Equal(1, updated);
        }

        var video = await WaitUntilFailedAsync(admin, id, EnglishBrowser);

        Assert.Equal("Texto viejo guardado en español.", video.GetProperty("error").GetString());
    }

    private static async Task<Guid> UploadVideoAsync(HttpClient admin, string content)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(TestVideos.Fake(content)) { Headers = { ContentType = new MediaTypeHeaderValue("video/mp4") } }, "file", "clip.mp4");
        using var response = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/media/videos", form));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<JsonElement> WaitUntilFailedAsync(HttpClient admin, Guid id, string? acceptLanguage)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (true)
        {
            using var response = await admin.SendAsync(WithLanguage(new HttpRequestMessage(HttpMethod.Get, $"/api/admin/media/videos/{id}"), acceptLanguage));
            var video = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (video.GetProperty("status").GetString() == "failed")
            {
                return video;
            }

            await Task.Delay(20, timeout.Token);
        }
    }

    private static HttpRequestMessage WithLanguage(HttpRequestMessage request, string? acceptLanguage)
    {
        if (acceptLanguage is not null)
        {
            request.Headers.TryAddWithoutValidation(AcceptLanguage, acceptLanguage);
        }

        return request;
    }

    private static async Task<JsonElement> AssertProblemAsync(
        HttpResponseMessage response, HttpStatusCode status, string title, string detail, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            ((int)status, title, detail, code),
            (problem.GetProperty("status").GetInt32(), problem.GetProperty("title").GetString(), problem.GetProperty("detail").GetString(),
                problem.GetProperty("code").GetString()));
        return problem;
    }
}
