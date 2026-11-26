using Blog.Application.Abstractions;
using Blog.Infrastructure.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests.Http;

/// <summary>
/// La API entera en memoria (TestServer), armada por el mismo Program.cs, con base, media, carpeta de trabajo y claves
/// de la cookie en una carpeta temporal propia. Solo se reemplazan el builder (cuenta pedidos) y ffmpeg (simulado: las
/// pruebas HTTP no lo necesitan). Corre como Production; <see cref="Development"/> es la misma API en Development.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string Password = "contraseña de prueba";
    public const string BuilderToken = "token-del-builder-para-pruebas-http-0123456789";

    /// <summary>La cabecera anti-CSRF que el middleware exige en toda petición que modifica datos.</summary>
    public const string CsrfHeader = "X-Requested-With";
    public const string CsrfValue = "blog-admin";

    private readonly string _directory = Path.Combine(Path.GetTempPath(), "blog-http-tests-" + Guid.NewGuid().ToString("N"));
    private WebApplicationFactory<Program>? _development;
    private HttpClient? _admin;
    private HttpClient? _developmentAdmin;

    public string MediaDirectory => Path.Combine(_directory, "media");

    /// <summary>Un archivo fuera de la carpeta de media: lo que un /media/../ intentaría leer.</summary>
    public string OutsideMediaFile => Path.Combine(_directory, "blog.db");

    internal CountingBuildTrigger Build { get; } = new();

    internal FakeVideoTranscoder Transcoder { get; } = new();

    /// <summary>La misma API (misma configuración y carpetas) en Development, donde sirve /media.</summary>
    public WebApplicationFactory<Program> Development =>
        _development ??= WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    /// <summary>Cliente sin sesión. HTTPS: la cookie de sesión es Secure y no viajaría por HTTP.</summary>
    public HttpClient CreateHttpsClient(WebApplicationFactory<Program>? factory = null) =>
        (factory ?? this).CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

    /// <summary>Un cliente con sesión, compartido: el login tiene rate limit (10 intentos cada 15 minutos por IP).</summary>
    public async Task<HttpClient> AdminClientAsync() => _admin ??= await LoggedInAsync(CreateHttpsClient());

    /// <summary>Lo mismo que <see cref="AdminClientAsync"/> contra la API en <see cref="Development"/> (tiene su propio límite).</summary>
    public async Task<HttpClient> DevelopmentAdminClientAsync() => _developmentAdmin ??= await LoggedInAsync(CreateHttpsClient(Development));

    /// <summary>Petición que modifica datos, con la cabecera anti-CSRF.</summary>
    public static HttpRequestMessage Mutation(HttpMethod method, string url, HttpContent? content = null) =>
        new(method, url) { Content = content, Headers = { { CsrfHeader, CsrfValue } } };

    public static HttpContent JsonContent(object value) => System.Net.Http.Json.JsonContent.Create(value);

    /// <summary>
    /// Rompe la base con la API andando: el archivo pasa a ser basura (como un disco dañado). Solo para una fábrica propia
    /// de la prueba, nunca para la compartida. Reintenta porque un worker puede tener el archivo abierto un instante.
    /// </summary>
    public async Task BreakDatabaseAsync()
    {
        var garbage = System.Text.Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("esto no es una base SQLite. ", 200)));
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Delete(OutsideMediaFile + "-wal");
                File.Delete(OutsideMediaFile + "-shm");
                await File.WriteAllBytesAsync(OutsideMediaFile, garbage);
                return;
            }
            catch (IOException) when (attempt < 50)
            {
                await Task.Delay(100);
            }
        }
    }

    private static async Task<HttpClient> LoggedInAsync(HttpClient client)
    {
        using var response = await client.SendAsync(Mutation(HttpMethod.Post, "/api/auth/login", JsonContent(new { password = Password })));
        response.EnsureSuccessStatusCode();
        return client;
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // UseSetting entra como configuración de mayor prioridad: le gana a appsettings.json y a los user-secrets.
        builder.UseEnvironment("Production");
        builder.UseSetting("ConnectionStrings:Blog", $"Data Source={OutsideMediaFile};Pooling=False");
        builder.UseSetting("Media:Directory", MediaDirectory);
        builder.UseSetting("Video:WorkDirectory", Path.Combine(_directory, "video-work"));
        builder.UseSetting("DataProtection:KeysDirectory", Path.Combine(_directory, "keys"));
        builder.UseSetting("Admin:PasswordHash", Pbkdf2PasswordHasher.Hash(Password, iterations: 1_000));
        builder.UseSetting("Builder:Token", BuilderToken);
        builder.UseSetting("Builder:Url", string.Empty);

        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ISiteBuildTrigger>(Build);
            services.AddSingleton<IVideoTranscoder>(Transcoder);
        });
    }
}

/// <summary>Todas las pruebas HTTP comparten una sola API (arrancarla cuesta) y corren una por vez.</summary>
[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "API HTTP";
}
