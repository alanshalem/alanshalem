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
using Microsoft.AspNetCore.DataProtection;

// Command-line modes (hash-password, healthcheck, backup): they run and exit without starting the API.
var readHiddenKey = Console.IsInputRedirected ? null : new Func<ConsoleKeyInfo>(() => Console.ReadKey(intercept: true));
if (await CommandLine.RunAsync(args, Console.In, Console.Out, Console.Error, readHiddenKey) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(args);

// Image uploads up to MediaService.MaxBytes plus a multipart margin (12 MB). The video upload raises its own limit.
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = MediaEndpoints.ServerRequestLimit);

// ---------- Required configuration: if anything is missing, the app does not start (better than failing in production) ----------
builder.Services
    .AddOptions<AdminOptions>()
    .Bind(builder.Configuration.GetSection("Admin"))
    .Validate(options => Pbkdf2PasswordHasher.IsHash(options.PasswordHash),
        "Admin:PasswordHash is missing or is not a valid hash (generate it with the hash-password command).")
    .ValidateOnStart();

builder.Services
    .AddOptions<BuilderOptions>()
    .Bind(builder.Configuration.GetSection("Builder"))
    .Validate(options => options.Token.Length >= 32, "Builder:Token must be at least 32 characters long.")
    .ValidateOnStart();

// ---------- Layers ----------
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

// Messages inside a response (a video's stored error, its size warnings) are written in the language of the request,
// like errors.
builder.Services.AddHttpContextAccessor();
builder.Services.AddOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>().Configure<IHttpContextAccessor>((options, http) =>
{
    options.SerializerOptions.Converters.Add(new StoredMessageJsonConverter(http));
    options.SerializerOptions.Converters.Add(new UserMessageJsonConverter(http));
});

// Every error is a problem details with a code, a title in the language of the request and Vary (LocalizedProblems).
builder.Services.AddProblemDetails(options => options.CustomizeProblemDetails = LocalizedProblems.Localize);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

// X-Forwarded-* is believed only when it comes from Caddy (Docker networks, configurable): the IP of the rate limit and the logs.
builder.Services.AddTrustedProxies(builder.Configuration);

// ---------- Authentication: session cookie of a single user ----------
// The keys that encrypt the cookie are stored on disk: otherwise every redeploy would log the admin out.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("blog");
if (builder.Configuration["DataProtection:KeysDirectory"] is { Length: > 0 } keysDirectory)
{
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysDirectory));
}

// __Host-admin cookie with the session epoch: logging out invalidates every issued cookie (AdminSession).
builder.Services.AddAdminSession();

// Brute-force protection: 10 login attempts every 15 minutes per IP (LoginRateLimit).
builder.Services.AddLoginRateLimit();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();

// The 4xx/5xx the framework (or a middleware here) leaves without a body come out as problem details: 401 without a
// session, 403 without the anti-CSRF header, 404, 405, 413, 415, 429 from the rate limit. It goes before all of them to wrap them.
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.UseDevelopmentMediaFiles();
}

// CSRF defense: every request that changes data must carry a custom header. A form or a tag from another site cannot
// add it, and for a fetch with a custom header the browser requires CORS permission (which we do not grant). It adds
// to the cookie's SameSite=Strict.
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

// ---------- Routes: each module maps only its own; the group applies the protection, once ----------
app.MapHealthEndpoints();
app.MapAuthEndpoints();

// Admin: requires the session cookie (and the middleware's anti-CSRF header on what changes data).
var admin = app.MapGroup("/api/admin").RequireAuthorization();
admin.MapAdminPostEndpoints();
admin.MapAdminMediaEndpoints();
admin.MapAdminSettingsEndpoints();
admin.MapAdminHeroImageEndpoints();

// Internal: consumed by the Astro builder, with its token. Caddy does not expose it to the outside.
var builderOnly = app.MapGroup("/api/internal").AddEndpointFilter<BuilderTokenFilter>();
builderOnly.MapInternalPostEndpoints();
builderOnly.MapInternalSettingsEndpoints();
builderOnly.MapInternalMediaEndpoints();
builderOnly.MapInternalHeroImageEndpoints();

await DatabaseInitializer.InitializeAsync(app.Services);
await app.RunAsync();
return 0;
