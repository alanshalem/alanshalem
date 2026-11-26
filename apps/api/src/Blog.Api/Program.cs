using System.Text.Json;
using System.Text.Json.Serialization;
using Blog.Api.Cli;
using Blog.Api.Endpoints;
using Blog.Api.Http;
using Blog.Api.Security;
using Blog.Application.HeroImages;
using Blog.Application.Media;
using Blog.Application.Posts;
using Blog.Application.Settings;
using Blog.Application.Videos;
using Blog.Infrastructure;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Security;
using Microsoft.AspNetCore.DataProtection;

// Modos de línea de comandos (hash-password, healthcheck, backup): corren y terminan sin levantar la API.
var readHiddenKey = Console.IsInputRedirected ? null : new Func<ConsoleKeyInfo>(() => Console.ReadKey(intercept: true));
if (await CommandLine.RunAsync(args, Console.In, Console.Out, Console.Error, readHiddenKey) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(args);

// Subidas de imágenes de hasta 8 MB (más un margen para el multipart). La subida de videos sube su propio límite.
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 12 * 1024 * 1024);

// ---------- Configuración obligatoria: si falta algo, la app no arranca (mejor que fallar en producción) ----------
builder.Services
    .AddOptions<AdminOptions>()
    .Bind(builder.Configuration.GetSection("Admin"))
    .Validate(options => Pbkdf2PasswordHasher.IsHash(options.PasswordHash),
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
builder.Services.AddScoped<HeroImageService>();
builder.Services.AddScoped<VideoService>();
builder.Services.AddScoped<VideoProcessor>();

// ---------- HTTP ----------
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

// Los mensajes guardados (error de un video) salen en el idioma del pedido, como los errores.
builder.Services.AddHttpContextAccessor();
builder.Services.AddOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>().Configure<IHttpContextAccessor>((options, http) =>
    options.SerializerOptions.Converters.Add(new StoredMessageJsonConverter(http)));

// Todo error es un problem details con code, título en el idioma del pedido y Vary (LocalizedProblems).
builder.Services.AddProblemDetails(options => options.CustomizeProblemDetails = LocalizedProblems.Localize);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

// X-Forwarded-* solo se cree si viene de Caddy (redes de Docker, configurables): la IP del rate limit y de los logs.
builder.Services.AddTrustedProxies(builder.Configuration);

// ---------- Autenticación: cookie de sesión de un único usuario ----------
// Las claves que cifran la cookie se guardan en disco: si no, cada redeploy cerraría la sesión.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("blog");
if (builder.Configuration["DataProtection:KeysDirectory"] is { Length: > 0 } keysDirectory)
{
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysDirectory));
}

// Cookie __Host-admin con la época de sesiones: cerrar sesión invalida toda cookie emitida (AdminSession).
builder.Services.AddAdminSession();

// Anti fuerza bruta: 10 intentos de login cada 15 minutos por IP (LoginRateLimit).
builder.Services.AddLoginRateLimit();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();

// Los 4xx/5xx que el framework (o un middleware de acá) deja sin cuerpo salen como problem details: 401 sin sesión, 403
// sin cabecera anti-CSRF, 404, 405, 413, 415, 429 del rate limit. Va antes que todos ellos para envolverlos.
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.UseDevelopmentMediaFiles();
}

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

// ---------- Rutas: cada módulo mapea solo lo suyo; la protección la pone el grupo, una sola vez ----------
app.MapHealthEndpoints();
app.MapAuthEndpoints();

// Admin: requiere la cookie de sesión (y la cabecera anti-CSRF del middleware en lo que modifica datos).
var admin = app.MapGroup("/api/admin").RequireAuthorization();
admin.MapAdminPostEndpoints();
admin.MapAdminMediaEndpoints();
admin.MapAdminSettingsEndpoints();
admin.MapAdminHeroImageEndpoints();

// Interno: lo consume el builder de Astro, con su token. Caddy no lo expone hacia afuera.
var builderOnly = app.MapGroup("/api/internal").AddEndpointFilter<BuilderTokenFilter>();
builderOnly.MapInternalPostEndpoints();
builderOnly.MapInternalSettingsEndpoints();
builderOnly.MapInternalMediaEndpoints();
builderOnly.MapInternalHeroImageEndpoints();

await DatabaseInitializer.InitializeAsync(app.Services);
await app.RunAsync();
return 0;
