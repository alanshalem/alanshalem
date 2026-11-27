using Blog.Application.Abstractions;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Media;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Scheduling;
using Blog.Infrastructure.Security;
using Blog.Infrastructure.Videos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure;

public static class DependencyInjection
{
    // Relative to the working directory: in development, the project's data/; the container configures another one.
    private const string DefaultConnectionString = "Data Source=data/blog.db";

    /// <summary>The database connection string: the API's and the command-line backup mode's.</summary>
    public static string ConnectionStringOf(IConfiguration configuration) =>
        configuration.GetConnectionString("Blog") ?? DefaultConnectionString;

    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // BuilderOptions is bound and validated once, by the host (Program.cs): the API also checks its token on
        // /api/internal, and a missing token must stop the API at startup.
        services.Configure<MediaOptions>(configuration.GetSection("Media"));
        services.Configure<VideoOptions>(configuration.GetSection("Video"));

        services.AddDbContext<BlogDbContext>(options => options.UseSqlite(ConnectionStringOf(configuration)));
        services.AddScoped<DatabaseReadiness>();

        services.AddScoped<IPostRepository, PostRepository>();
        services.AddScoped<ISiteSettingsRepository, SiteSettingsRepository>();
        services.AddScoped<IMediaAssetRepository, MediaAssetRepository>();
        services.AddScoped<IHeroImageRepository, HeroImageRepository>();
        services.AddScoped<IVideoAssetRepository, VideoAssetRepository>();
        services.AddSingleton<IClock, SystemClock>();

        // Singleton: keeps in memory the session epoch, which is checked on every request with a session.
        services.AddSingleton<IAdminSessionEpoch, AdminSessionEpoch>();
        services.AddSingleton<IMediaStorage, DiskMediaStorage>();

        // Singleton: its semaphore is what guarantees a single image is processed at a time in the whole process.
        services.AddSingleton<IImageProcessor, NetVipsImageProcessor>();

        // Videos: a single worker consumes the queue, so one video is processed at a time (ffmpeg uses a lot of CPU).
        // The worker takes VideoProcessor (Application) from the container: the API registers it with the other use cases.
        services.AddSingleton<IVideoTranscoder, FfmpegVideoTranscoder>();
        services.AddSingleton<IVideoStaging, DiskVideoStaging>();
        services.AddSingleton<ChannelVideoQueue>();
        services.AddSingleton<IVideoQueue>(provider => provider.GetRequiredService<ChannelVideoQueue>());
        services.AddHostedService<VideoProcessingWorker>();

        // Scheduled publishing: takes PostService (Application) from the container, like the video worker.
        services.AddHostedService<ScheduledPublishingWorker>();

        // Site regeneration: every use case and the scheduled publishing request it through the durable trigger (a mark
        // in the database + an HTTP send); the worker retries the mark the builder did not accept.
        services.AddScoped<DurableSiteBuildTrigger>();
        services.AddScoped<ISiteBuildTrigger>(provider => provider.GetRequiredService<DurableSiteBuildTrigger>());
        services.AddHostedService<SiteRebuildWorker>();
        services.AddHttpClient<IBuildRequestSender, HttpBuildRequestSender>(client => client.Timeout = HttpBuildRequestSender.RequestTimeout);

        return services;
    }
}
