using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

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
