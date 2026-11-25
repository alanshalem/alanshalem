using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Blog.Tests.Http;

/// <summary>Historial de versiones y publicación programada tal como los ve el admin: rutas, formas del JSON y códigos.</summary>
[Collection(ApiCollection.Name)]
public class PostHistoryAndScheduleHttpTests(ApiFactory api)
{
    [Fact]
    public async Task Revisions_are_listed_newest_first_shown_whole_and_restored_as_a_new_revision_and_unknown_ones_are_404()
    {
        var admin = await api.AdminClientAsync();
        var id = (await SendAsync(admin, HttpMethod.Post, "/api/admin/posts", new { title = "Historial http", body = "uno", tags = new[] { "net" } }))
            .GetProperty("id").GetGuid();
        await SendAsync(admin, HttpMethod.Put, $"/api/admin/posts/{id}", new { title = "Historial http 2", slug = "historial-http", body = "dos" });

        var list = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/posts/{id}/revisions");
        Assert.Equal([2, 1], list.EnumerateArray().Select(revision => revision.GetProperty("number").GetInt32()));
        Assert.Equal(["id", "number", "createdAt", "title", "bodyLength"], list[1].EnumerateObject().Select(property => property.Name));
        Assert.Equal(("Historial http", 3), (list[1].GetProperty("title").GetString(), list[1].GetProperty("bodyLength").GetInt32()));
        var firstId = list[1].GetProperty("id").GetGuid();

        var first = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/posts/{id}/revisions/{firstId}");
        Assert.Equal(
            ["id", "number", "createdAt", "title", "slug", "summary", "body", "tags", "coverUrl", "coverAlt"],
            first.EnumerateObject().Select(property => property.Name));
        Assert.Equal(("historial-http", "uno", "net"), (
            first.GetProperty("slug").GetString(), first.GetProperty("body").GetString(), first.GetProperty("tags")[0].GetString()));

        var restored = await SendAsync(admin, HttpMethod.Post, $"/api/admin/posts/{id}/revisions/{firstId}/restore");
        Assert.Equal(("Historial http", "uno", id), (
            restored.GetProperty("title").GetString(), restored.GetProperty("body").GetString(), restored.GetProperty("id").GetGuid()));
        var after = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/posts/{id}/revisions");
        Assert.Equal([3, 2, 1], after.EnumerateArray().Select(revision => revision.GetProperty("number").GetInt32()));

        var unknown = Guid.NewGuid();
        await AssertProblemAsync(await admin.GetAsync($"/api/admin/posts/{unknown}/revisions"), HttpStatusCode.NotFound, "El post no existe.");
        await AssertProblemAsync(await admin.GetAsync($"/api/admin/posts/{id}/revisions/{unknown}"), HttpStatusCode.NotFound, "La versión no existe.");
        await AssertProblemAsync(
            await admin.SendAsync(ApiFactory.Mutation(HttpMethod.Post, $"/api/admin/posts/{id}/revisions/{unknown}/restore")),
            HttpStatusCode.NotFound,
            "La versión no existe.");
    }

    [Fact]
    public async Task Scheduling_takes_an_iso_date_with_offset_answers_400_in_spanish_and_cancelling_clears_it()
    {
        var admin = await api.AdminClientAsync();
        var id = (await SendAsync(admin, HttpMethod.Post, "/api/admin/posts", new { title = "Programado http", body = "cuerpo" }))
            .GetProperty("id").GetGuid();
        var buildsBefore = api.Build.Requests;

        var scheduled = await SendAsync(admin, HttpMethod.Put, $"/api/admin/posts/{id}/schedule", new { publishAt = "2999-01-01T09:00:00-03:00" });
        Assert.Equal(("2999-01-01T12:00:00Z", "draft"), (scheduled.GetProperty("scheduledAt").GetString(), scheduled.GetProperty("status").GetString()));
        var summary = (await admin.GetFromJsonAsync<JsonElement>("/api/admin/posts")).EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal("2999-01-01T12:00:00Z", summary.GetProperty("scheduledAt").GetString());

        await AssertProblemAsync(await ScheduleAsync(admin, id, "2000-01-01T00:00:00Z"), HttpStatusCode.BadRequest, ScheduleMessages.Past);
        await AssertProblemAsync(await ScheduleAsync(admin, id, "mañana"), HttpStatusCode.BadRequest, ScheduleMessages.BadFormat);
        await AssertProblemAsync(await ScheduleAsync(admin, Guid.NewGuid(), "2999-01-01T09:00:00Z"), HttpStatusCode.NotFound, "El post no existe.");

        var cancelled = await SendAsync(admin, HttpMethod.Delete, $"/api/admin/posts/{id}/schedule");
        Assert.Equal(JsonValueKind.Null, cancelled.GetProperty("scheduledAt").ValueKind);

        await SendAsync(admin, HttpMethod.Post, $"/api/admin/posts/{id}/publish");
        await AssertProblemAsync(await ScheduleAsync(admin, id, "2999-01-01T09:00:00Z"), HttpStatusCode.BadRequest, ScheduleMessages.Published);
        // Solo la publicación manual regenera el sitio: programar o cancelar un borrador no cambia lo que ve el público.
        Assert.Equal(buildsBefore + 1, api.Build.Requests);
    }

    private static Task<HttpResponseMessage> ScheduleAsync(HttpClient admin, Guid id, string publishAt) =>
        admin.SendAsync(ApiFactory.Mutation(HttpMethod.Put, $"/api/admin/posts/{id}/schedule", ApiFactory.JsonContent(new { publishAt })));

    /// <summary>Envía la mutación con la cabecera anti-CSRF y exige un 2xx con cuerpo JSON.</summary>
    private static async Task<JsonElement> SendAsync(HttpClient admin, HttpMethod method, string url, object? body = null)
    {
        using var response = await admin.SendAsync(ApiFactory.Mutation(method, url, body is null ? null : ApiFactory.JsonContent(body)));
        Assert.True(response.IsSuccessStatusCode, $"{method} {url} respondió {(int)response.StatusCode}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string detail)
    {
        using (response)
        {
            Assert.Equal(status, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(detail, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
        }
    }
}

/// <summary>Los mensajes de la programación, compartidos por las pruebas de dominio, de casos de uso y HTTP.</summary>
internal static class ScheduleMessages
{
    public const string Missing = "Indicá la fecha y hora de publicación.";
    public const string BadFormat = "La fecha de publicación no es válida: usá ISO 8601 con zona horaria (ej. 2026-12-01T09:00:00-03:00).";
    public const string Past = "La fecha de publicación tiene que ser en el futuro.";
    public const string Published = "El post ya está publicado: no se puede programar.";
}
