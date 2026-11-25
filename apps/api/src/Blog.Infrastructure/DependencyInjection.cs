using Blog.Application.Abstractions;
using Blog.Infrastructure.Build;
using Blog.Infrastructure.Media;
using Blog.Infrastructure.Persistence;
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

        services.AddDbContext<BlogDbContext>(options =>
            options.UseSqlite(configuration.GetConnectionString("Blog") ?? "Data Source=data/blog.db"));

        services.AddScoped<IPostRepository, PostRepository>();
        services.AddScoped<ISiteSettingsRepository, SiteSettingsRepository>();
        services.AddScoped<IMediaAssetRepository, MediaAssetRepository>();
        services.AddScoped<IHeroImageRepository, HeroImageRepository>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IMediaStorage, DiskMediaStorage>();

        // Singleton: su semáforo es el que garantiza que se procese una sola imagen a la vez en todo el proceso.
        services.AddSingleton<IImageProcessor, NetVipsImageProcessor>();

        // Timeout corto: guardar un post no debe quedarse esperando a un builder que no responde.
        services.AddHttpClient<ISiteBuildTrigger, HttpSiteBuildTrigger>(client => client.Timeout = TimeSpan.FromSeconds(5));

        return services;
    }
}
