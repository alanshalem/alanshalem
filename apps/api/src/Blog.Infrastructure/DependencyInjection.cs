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
    // Relativa a la carpeta de trabajo: en desarrollo, la data/ del proyecto; en el contenedor se configura otra.
    private const string DefaultConnectionString = "Data Source=data/blog.db";

    /// <summary>La cadena de conexión de la base: la de la API y la del modo backup de la línea de comandos.</summary>
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

        // Singleton: guarda en memoria la época de las sesiones, que se consulta en cada pedido con sesión.
        services.AddSingleton<IAdminSessionEpoch, AdminSessionEpoch>();
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

        // Regeneración del sitio: todos los casos de uso y la publicación programada piden por el trigger durable (marca
        // en la base + envío HTTP); el worker reintenta la marca que el builder no aceptó.
        services.AddScoped<DurableSiteBuildTrigger>();
        services.AddScoped<ISiteBuildTrigger>(provider => provider.GetRequiredService<DurableSiteBuildTrigger>());
        services.AddHostedService<SiteRebuildWorker>();
        services.AddHttpClient<IBuildRequestSender, HttpBuildRequestSender>(client => client.Timeout = HttpBuildRequestSender.RequestTimeout);

        return services;
    }
}
