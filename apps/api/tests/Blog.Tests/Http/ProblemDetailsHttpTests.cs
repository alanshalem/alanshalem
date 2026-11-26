using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Blog.Tests.Http;

/// <summary>
/// Todo error de la API es un problem details con "code" estable, título en el idioma del pedido y
/// Vary: Accept-Language, también los que arma el framework sin cuerpo (401, 403, 404, 405, 413, 415, 429) y los
/// pedidos mal formados (JSON inválido, formulario sin archivo), igual en Development que en Production.
/// </summary>
[Collection(ApiCollection.Name)]
public class ProblemDetailsHttpTests(ApiFactory api)
{
    private const string AnyId = "0198f3a0-0000-7000-8000-000000000000";

    [Theory]
    [InlineData(null, "No autorizado")]
    [InlineData("en", "Unauthorized")]
    public async Task A_route_without_a_session_is_a_401_problem(string? language, string title)
    {
        using var client = api.CreateHttpsClient();

        using var response = await client.SendAsync(WithLanguage(new HttpRequestMessage(HttpMethod.Get, "/api/auth/me"), language));

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, title, "problem.unauthorized");
    }

    [Fact]
    public async Task An_internal_route_without_the_builder_token_is_a_401_problem()
    {
        using var client = api.CreateHttpsClient();

        using var internalRoute = await client.GetAsync("/api/internal/posts");

        await AssertProblemAsync(internalRoute, HttpStatusCode.Unauthorized, "No autorizado", "problem.unauthorized");
    }

    [Theory]
    [InlineData(null, "Acceso denegado")]
    [InlineData("en-GB", "Forbidden")]
    public async Task A_mutation_without_the_csrf_header_is_a_403_problem(string? language, string title)
    {
        var admin = await api.AdminClientAsync();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/admin/posts") { Content = ApiFactory.JsonContent(new { title = "x" }) };

        using var response = await admin.SendAsync(WithLanguage(request, language));

        await AssertProblemAsync(response, HttpStatusCode.Forbidden, title, "problem.forbidden");
    }

    [Theory]
    [InlineData(null, "No encontrado")]
    [InlineData("en", "Not found")]
    public async Task An_unknown_route_is_a_404_problem(string? language, string title)
    {
        using var client = api.CreateHttpsClient();

        using var response = await client.SendAsync(WithLanguage(new HttpRequestMessage(HttpMethod.Get, "/api/no-existe"), language));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, title, "problem.notFound");
    }

    [Theory]
    [InlineData(null, "Método no permitido")]
    [InlineData("en", "Method not allowed")]
    public async Task A_wrong_method_is_a_405_problem(string? language, string title)
    {
        using var client = api.CreateHttpsClient();

        using var response = await client.SendAsync(WithLanguage(ApiFactory.Mutation(HttpMethod.Put, "/api/health"), language));

        await AssertProblemAsync(response, HttpStatusCode.MethodNotAllowed, title, "problem.methodNotAllowed");
    }

    [Theory]
    [InlineData(null, "Tipo de contenido no soportado")]
    [InlineData("en", "Unsupported media type")]
    public async Task A_body_that_is_not_json_is_a_415_problem(string? language, string title)
    {
        var admin = await api.AdminClientAsync();
        var request = ApiFactory.Mutation(HttpMethod.Post, "/api/admin/posts", new StringContent("title=x", Encoding.UTF8, "text/plain"));

        using var response = await admin.SendAsync(WithLanguage(request, language));

        await AssertProblemAsync(response, HttpStatusCode.UnsupportedMediaType, title, "problem.unsupportedMediaType");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_body_over_the_server_limit_is_a_413_problem(bool development)
    {
        // TestServer no aplica el límite de Kestrel: esta prueba levanta la API en un Kestrel real (fábrica propia).
        await using var own = new ApiFactory();
        var server = development ? own.Development : own;
        server.UseKestrel(options => options.Listen(System.Net.IPAddress.Loopback, 0));
        server.StartServer();
        using var client = server.CreateClient();
        var request = WithLanguage(ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", new ByteArrayContent(new byte[13 * 1024 * 1024])
        {
            Headers = { ContentType = new MediaTypeHeaderValue("application/json") },
        }), "en");
        // Con Expect: 100-continue el cliente espera la respuesta antes de mandar los 13 MB que el servidor no va a leer.
        request.Headers.ExpectContinue = true;

        using var response = await client.SendAsync(request);

        await AssertProblemAsync(response, HttpStatusCode.RequestEntityTooLarge, "Payload too large", "problem.payloadTooLarge");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Invalid_utf8_json_is_a_400_problem_in_every_environment(bool development)
    {
        var admin = await AdminAsync(development);
        var content = new ByteArrayContent([.. "{\"title\":\""u8, 0xC3, 0x28, .. "\"}"u8]) { Headers = { ContentType = new MediaTypeHeaderValue("application/json") } };

        using var response = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/posts", content));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "Datos inválidos", "problem.badRequest");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Malformed_json_is_a_400_problem_in_every_environment(bool development)
    {
        var admin = await AdminAsync(development);
        var content = new StringContent("{\"title\": ", Encoding.UTF8, "application/json");

        using var response = await admin.SendAsync(WithLanguage(ApiFactory.Mutation(HttpMethod.Post, "/api/admin/posts", content), "en"));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "Invalid data", "problem.badRequest");
    }

    [Theory]
    [InlineData(false, "/api/admin/media")]
    [InlineData(true, "/api/admin/media")]
    [InlineData(false, "/api/admin/media/videos")]
    [InlineData(true, "/api/admin/media/videos")]
    public async Task A_multipart_upload_without_file_is_a_400_problem_in_every_environment(bool development, string url)
    {
        var admin = await AdminAsync(development);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("1.5"), "trimEnd");

        using var response = await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, url, form));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "Datos inválidos", "problem.badRequest");
    }

    [Fact]
    public async Task A_missing_resource_keeps_its_own_code_and_detail()
    {
        var admin = await api.AdminClientAsync();

        using var response = await admin.GetAsync($"/api/admin/posts/{AnyId}");

        var problem = await AssertProblemAsync(response, HttpStatusCode.NotFound, "No encontrado", "post.notFound");
        Assert.Equal("El post no existe.", problem.GetProperty("detail").GetString());
    }

    [Theory]
    [InlineData(null, "Demasiados pedidos")]
    [InlineData("en", "Too many requests")]
    public async Task Too_many_login_attempts_are_a_429_problem(string? language, string title)
    {
        // Fábrica propia: agotar el límite del login en la compartida bloquearía al resto de las pruebas.
        await using var own = new ApiFactory();
        using var client = own.CreateHttpsClient();
        HttpResponseMessage? last = null;
        for (var attempt = 0; attempt < 11; attempt++)
        {
            last?.Dispose();
            last = await client.SendAsync(WithLanguage(
                ApiFactory.Mutation(HttpMethod.Post, "/api/auth/login", ApiFactory.JsonContent(new { password = "otra" })), language));
        }

        using var response = last!;
        await AssertProblemAsync(response, HttpStatusCode.TooManyRequests, title, "problem.tooManyRequests");
    }

    private Task<HttpClient> AdminAsync(bool development) =>
        development ? api.DevelopmentAdminClientAsync() : api.AdminClientAsync();

    private static HttpRequestMessage WithLanguage(HttpRequestMessage request, string? language)
    {
        if (language is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Language", language);
        }

        return request;
    }

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string title, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Accept-Language", response.Headers.Vary);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            ((int)status, title, code),
            (problem.GetProperty("status").GetInt32(), problem.GetProperty("title").GetString(), problem.GetProperty("code").GetString()));
        return problem;
    }
}
