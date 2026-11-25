using Blog.Application.Abstractions;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Media;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Scheduling;
using Blog.Infrastructure.Videos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<MediaOptions>(configuration.GetSection("Media"));
        services.Configure<BuilderOptions>(configuration.GetSection("Builder"));
        services.Configure<VideoOptions>(configuration.GetSection("Video"));

        services.AddDbContext<BlogDbContext>(options =>
            options.UseSqlite(configuration.GetConnectionString("Blog") ?? "Data Source=data/blog.db"));

        services.AddScoped<IPostRepository, PostRepository>();
        services.AddScoped<ISiteSettingsRepository, SiteSettingsRepository>();
        services.AddScoped<IMediaAssetRepository, MediaAssetRepository>();
        services.AddScoped<IHeroImageRepository, HeroImageRepository>();
        services.AddScoped<IVideoAssetRepository, VideoAssetRepository>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IMediaStorage, DiskMediaStorage>();

        // Singleton: su semáforo es el que garantiza que se procese una sola imagen a la vez en todo el proceso.
        services.AddSingleton<IImageProcessor, NetVipsImageProcessor>();

        // Videos: un único worker consume la cola, así se procesa un video a la vez (ffmpeg usa mucha CPU).
        // El worker saca VideoProcessor (Application) del contenedor: lo registra la API junto a los otros casos de uso.
        services.AddSingleton<IVideoTranscoder, FfmpegVideoTranscoder>();
        services.AddSingleton<IVideoStaging, DiskVideoStaging>();
        services.AddSingleton<ChannelVideoQueue>();
        services.AddSingleton<IVideoQueue>(provider => provider.GetRequiredService<ChannelVideoQueue>());
        services.AddHostedService<VideoProcessingWorker>();

        // Publicación programada: saca PostService (Application) del contenedor, como el worker de videos.
        services.AddHostedService<ScheduledPublishingWorker>();

        // Timeout corto: guardar un post no debe quedarse esperando a un builder que no responde.
        services.AddHttpClient<ISiteBuildTrigger, HttpSiteBuildTrigger>(client => client.Timeout = TimeSpan.FromSeconds(5));

        return services;
    }
}
