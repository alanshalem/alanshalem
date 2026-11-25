using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Blog.Api.Endpoints;
using Blog.Api.Http;
using Blog.Api.Security;
using Blog.Application.Media;
using Blog.Application.Posts;
using Blog.Application.Settings;
using Blog.Infrastructure;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;

// Herramienta de línea de comandos para generar el hash de la contraseña del admin:
//   dotnet run --project src/Blog.Api -- hash-password
if (args is ["hash-password"])
{
    Console.Error.Write("Contraseña: ");
    var password = Console.ReadLine();
    if (string.IsNullOrEmpty(password))
    {
        Console.Error.WriteLine("La contraseña no puede estar vacía.");
        return 1;
    }

    Console.WriteLine(Pbkdf2PasswordHasher.Hash(password));
    return 0;
}

var builder = WebApplication.CreateBuilder(args);

// Subidas de imágenes de hasta 8 MB (más un margen para el multipart).
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 12 * 1024 * 1024);

// ---------- Configuración obligatoria: si falta algo, la app no arranca (mejor que fallar en producción) ----------
builder.Services
    .AddOptions<AdminOptions>()
    .Bind(builder.Configuration.GetSection("Admin"))
    .Validate(options => options.PasswordHash.StartsWith("pbkdf2-sha256$", StringComparison.Ordinal),
        "Admin:PasswordHash falta o no es un hash válido (generalo con el comando hash-password).")
    .ValidateOnStart();

builder.Services
    .AddOptions<BuilderOptions>()
    .Bind(builder.Configuration.GetSection("Builder"))
    .Validate(options => options.Token.Length >= 32, "Builder:Token debe tener al menos 32 caracteres.")
    .ValidateOnStart();

// ---------- Capas ----------
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddScoped<PostService>();
builder.Services.AddScoped<MediaService>();
builder.Services.AddScoped<SiteSettingsService>();

// ---------- HTTP ----------
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

// La API solo es alcanzable desde Caddy (red interna de Docker), así que se confía en sus cabeceras X-Forwarded-*.
// Sin esto, el rate limit vería siempre la IP de Caddy y bloquearía a todos juntos.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// ---------- Autenticación: cookie de sesión de un único usuario ----------
// Las claves que cifran la cookie se guardan en disco: si no, cada redeploy cerraría la sesión.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("blog");
if (builder.Configuration["DataProtection:KeysDirectory"] is { Length: > 0 } keysDirectory)
{
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysDirectory));
}

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "__Host-admin"; // el prefijo __Host- obliga a Secure + Path=/ y prohíbe Domain
        options.Cookie.HttpOnly = true; // JavaScript no puede leerla (mitiga robo por XSS)
        options.Cookie.SameSite = SameSiteMode.Strict; // no viaja en peticiones iniciadas desde otros sitios
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = false;

        // Es una API: sin sesión se responde 401/403, no se redirige a una página de login.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

// ---------- Anti fuerza bruta en el login: 10 intentos cada 15 minutos por IP ----------
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(15),
            QueueLimit = 0,
        }));
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();

// Defensa CSRF: toda petición que modifica datos debe traer una cabecera personalizada. Un formulario o una
// etiqueta de otro sitio no puede agregarla, y para un fetch con cabecera propia el navegador exige permiso CORS
// (que no concedemos). Se suma a SameSite=Strict de la cookie.
app.Use(async (context, next) =>
{
    var request = context.Request;
    var isSafeMethod = HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method) || HttpMethods.IsOptions(request.Method);
    if (!isSafeMethod
        && request.Path.StartsWithSegments("/api")
        && request.Headers["X-Requested-With"] != "blog-admin")
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    await next();
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapPostEndpoints();

await DatabaseInitializer.InitializeAsync(app.Services);
await app.RunAsync();
return 0;
