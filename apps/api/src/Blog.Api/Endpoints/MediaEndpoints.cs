using Blog.Application.Media;
using Blog.Application.Videos;
using Blog.Domain;
using Blog.Infrastructure.Media;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

namespace Blog.Api.Endpoints;

public static class MediaEndpoints
{
    /// <summary>
    /// Kestrel's limit for every request (Program.cs): the largest image plus a margin for its multipart envelope. Images
    /// ride on this global limit; only the video upload raises its own (<see cref="VideoRequestLimit"/>).
    /// </summary>
    internal const long ServerRequestLimit = MediaService.MaxBytes + ImageEnvelopeMargin;

    // With this margin an image somewhat over the maximum still reaches the use case and gets its own message (in the
    // admin's language) instead of a generic 413.
    private const long ImageEnvelopeMargin = 4 * 1024 * 1024;

    // Margin for the multipart envelope (headers and boundaries) above the file maximum: this way a video barely larger
    // than the maximum gets the use case's own message (in the admin's language), not a generic 413.
    private const long MultipartMargin = 1024 * 1024;
    private const long VideoRequestLimit = VideoService.MaxBytes + MultipartMargin;

    /// <summary>Image and video upload inside the /api/admin group.</summary>
    public static RouteGroupBuilder MapAdminMediaEndpoints(this RouteGroupBuilder admin)
    {
        // ASP.NET's CSRF protection (antiforgery) is replaced by the X-Requested-With header the middleware requires.
        // Returns the optimized asset (keeps "url").
        admin.MapPost("/media", async (IFormFile file, MediaService media, CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                return await media.UploadImageAsync(stream, ct);
            })
            .DisableAntiforgery();

        // 202: the video is validated and queued; the admin polls GET .../videos/{id} until it is ready. The 200 MB
        // limit is raised only on this route (the rest of the API keeps Kestrel's). ASP.NET stores on disk every file
        // over 64 KB when reading the form, so the upload is never whole in memory.
        // Trim and fade are optional fields of the same form, as text: the use case reads and validates them.
        admin.MapPost("/media/videos", async (
                IFormFile file,
                [FromForm] string? trimStart,
                [FromForm] string? trimEnd,
                [FromForm] string? fade,
                [FromForm] string? fadeSeconds,
                VideoService videos,
                CancellationToken ct) =>
            {
                await using var stream = file.OpenReadStream();
                var video = await videos.UploadAsync(stream, new VideoEditInput(trimStart, trimEnd, fade, fadeSeconds), ct);
                return Results.Accepted($"/api/admin/media/videos/{video.Id}", video);
            })
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(VideoRequestLimit))
            .WithFormOptions(multipartBodyLengthLimit: VideoRequestLimit);

        admin.MapGet("/media/videos/{id:guid}", (Guid id, VideoService videos, CancellationToken ct) => videos.GetAsync(id, ct));

        return admin;
    }

    /// <summary>
    /// Every uploaded image, so the builder builds the srcset of any /media/... on the site. Inside the
    /// /api/internal group (builder token).
    /// </summary>
    public static RouteGroupBuilder MapInternalMediaEndpoints(this RouteGroupBuilder builderOnly)
    {
        builderOnly.MapGet("/media", (MediaService media, CancellationToken ct) => media.ListAsync(ct));

        return builderOnly;
    }

    /// <summary>
    /// Development only: the API serves the media folder so the admin can show the previews.
    /// In production Caddy serves /media straight from the volume, with an immutable cache.
    /// </summary>
    public static WebApplication UseDevelopmentMediaFiles(this WebApplication app)
    {
        var directory = Path.GetFullPath(app.Services.GetRequiredService<IOptions<MediaOptions>>().Value.Directory);
        Directory.CreateDirectory(directory); // PhysicalFileProvider requires the folder to exist

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(directory),
            RequestPath = WebUrl.MediaPrefix.TrimEnd('/'),
        });

        return app;
    }
}
