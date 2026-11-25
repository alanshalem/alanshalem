using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// Convierte un video ya validado: versiones AV1 y H.264 sin audio con su recorte y fundido, y el póster por el
/// pipeline de imágenes. Lo llama el proceso en segundo plano, de a un video por vez.
/// </summary>
public sealed class VideoProcessor(
    IVideoTranscoder transcoder,
    IVideoStaging staging,
    IVideoAssetRepository videos,
    MediaService media,
    IMediaStorage storage)
{
    private const string InterruptedMessage = "Se interrumpió el procesamiento porque el servidor se reinició. Volvé a subir el video.";
    private const string UnexpectedMessage = "No se pudo procesar el video por un error del servidor. Volvé a subirlo más tarde.";

    /// <remarks>
    /// Un error previsto (<see cref="IsExpected"/>) queda como error del video. Uno inesperado también, con un mensaje
    /// genérico, y además se relanza para que el proceso en segundo plano lo registre con sus detalles. Un apagado del
    /// servidor no se registra como fallo: el video queda en "processing" y lo resuelve el próximo arranque.
    /// </remarks>
    /// <exception cref="AggregateException">Si tampoco se pudo guardar el fallo: trae el error original y el del guardado.</exception>
    public async Task ProcessAsync(VideoJob job, CancellationToken cancellationToken)
    {
        try
        {
            var video = await videos.GetByIdAsync(job.VideoId, cancellationToken);
            if (video is { Status: VideoStatus.Processing })
            {
                await ConvertAsync(video, job.SourcePath, cancellationToken);
            }
        }
        catch (Exception error) when (!IsShutdown(error, cancellationToken))
        {
            await RecordFailureAsync(job.VideoId, error);
            if (!IsExpected(error))
            {
                throw;
            }
        }
        finally
        {
            staging.Delete(job.SourcePath);
        }
    }

    /// <summary>
    /// Al arrancar: la cola vive en memoria, así que un video que quedó en "processing" ya no tiene quién lo procese.
    /// Se marca como fallido (el admin lo vuelve a subir y se reprocesa) y se borra lo que quedó en la carpeta de
    /// trabajo. Es más simple y predecible que reencolar: los originales no necesitan sobrevivir a un reinicio.
    /// </summary>
    public async Task FailInterruptedAsync(CancellationToken cancellationToken)
    {
        foreach (var video in await videos.ListProcessingAsync(cancellationToken))
        {
            video.MarkFailed(InterruptedMessage);
        }

        await videos.SaveChangesAsync(cancellationToken);
        staging.Clear();
    }

    private async Task ConvertAsync(VideoAsset video, string sourcePath, CancellationToken cancellationToken)
    {
        // Todo se genera primero en la carpeta de trabajo: si ffmpeg falla, a /media no llega ningún archivo a medias.
        var transcoded = await transcoder.TranscodeAsync(sourcePath, VideoVariant.For(video.Height), video.Edit, cancellationToken);

        await using var posterContent = new MemoryStream(transcoded.Poster);
        var poster = await media.StoreImageAsync(posterContent, cancellationToken);

        // Primero los archivos y después el estado: un video "ready" nunca apunta a archivos que no existen.
        foreach (var file in transcoded.Files)
        {
            await storage.SaveAsync(video.RelativePathOf(file.Variant), file.Content, cancellationToken);
        }

        video.MarkReady(poster, [.. transcoded.Files.Select(file => new VideoSource(file.Variant.Codec, file.Variant.Height, file.Content.Length))]);
        await videos.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Errores con un mensaje ya escrito para el admin (ffmpeg falló, el póster no se pudo leer); otro es un defecto o una falla del servidor.</summary>
    private static bool IsExpected(Exception error) => error is VideoProcessingException or DomainException;

    private static bool IsShutdown(Exception error, CancellationToken cancellationToken) =>
        error is OperationCanceledException && cancellationToken.IsCancellationRequested;

    /// <summary>
    /// Guarda el fallo partiendo de lo que está en la base, no del video en memoria: si el error saltó al guardar después
    /// de MarkReady, en memoria ya figura listo y marcarlo fallido lanzaría otra excepción que taparía la original.
    /// </summary>
    /// <exception cref="AggregateException">
    /// Si no se puede guardar: con los dos errores, para que se registre el original y no solo el del guardado. El video
    /// queda en "processing" y lo resuelve el próximo arranque (<see cref="FailInterruptedAsync"/>).
    /// </exception>
    private async Task RecordFailureAsync(Guid videoId, Exception error)
    {
        try
        {
            // Sin cancelación: el fallo se guarda aunque justo empiece el apagado.
            var video = await videos.ReloadAsync(videoId, CancellationToken.None);
            if (video is { Status: VideoStatus.Processing })
            {
                video.MarkFailed(IsExpected(error) ? error.Message : UnexpectedMessage);
                await videos.SaveChangesAsync(CancellationToken.None);
            }
        }
        catch (Exception saveError)
        {
            throw new AggregateException($"No se pudo guardar el fallo del video {videoId}.", error, saveError);
        }
    }
}
