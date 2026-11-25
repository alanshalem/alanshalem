using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// Subida de videos para el hero. Valida enseguida (formato, tamaño del archivo, recorte y fundido, regla de tamaño
/// del hero) y deja el video en "processing" para que <see cref="VideoProcessor"/> lo convierta en segundo plano: convertir
/// tarda minutos y el pedido HTTP no puede esperar tanto.
/// </summary>
public sealed class VideoService(
    IVideoStaging staging,
    IVideoTranscoder transcoder,
    IVideoQueue queue,
    IVideoAssetRepository videos,
    IMediaStorage storage,
    IClock clock)
{
    public const long MaxBytes = 200L * 1024 * 1024;

    public async Task<VideoAssetDto> UploadAsync(Stream content, VideoEditInput edit, CancellationToken cancellationToken)
    {
        var staged = await staging.SaveAsync(content, MaxBytes, cancellationToken);
        var queued = false;
        try
        {
            if (staged.Length > MaxBytes)
            {
                throw new DomainException($"El video supera el máximo de {MaxBytes / (1024 * 1024)} MB.");
            }

            if (!VideoSniffer.IsSupportedContainer(staged.Head))
            {
                throw new DomainException("Formato no soportado. Subí un video MP4, MOV, WebM o MKV.");
            }

            // La edición se valida contra la duración real del original, así que primero se lee con ffprobe.
            var probe = await transcoder.ProbeAsync(staged.Path, cancellationToken)
                ?? throw new DomainException("No se pudo leer el video: el archivo está dañado o no tiene imagen.");
            var validEdit = edit.ToEdit(probe.DurationSeconds);

            // Mismo video con la misma edición = mismo hash = mismo asset: si ya está (o se está procesando) se devuelve
            // tal cual, salvo que haya que procesarlo de nuevo (ver NeedsProcessingAgain).
            var existing = await videos.GetByHashAsync(VideoAsset.HashOf(staged.Hash, validEdit), cancellationToken);
            if (existing is not null && !NeedsProcessingAgain(existing))
            {
                return existing.ToDto();
            }

            var video = existing ?? VideoAsset.Create(staged.Hash, probe.Width, probe.Height, validEdit, clock.UtcNow);
            if (existing is null)
            {
                videos.Add(video);
            }
            else
            {
                existing.Retry();
            }

            await videos.SaveChangesAsync(cancellationToken);
            queue.Enqueue(new VideoJob(video.Id, staged.Path));
            queued = true;
            return video.ToDto();
        }
        finally
        {
            // El original solo se queda si entró en la cola: un rechazo o un duplicado no deja nada en disco.
            if (!queued)
            {
                staging.Delete(staged.Path);
            }
        }
    }

    public async Task<VideoAssetDto> GetAsync(Guid id, CancellationToken cancellationToken) =>
        (await videos.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("El video no existe.")).ToDto();

    // Uno que falló, así el admin siempre tiene una salida: subirlo de nuevo. Y uno listo al que le falta algún archivo
    // (fuente o póster), igual que con las imágenes: si no, el sitio apuntaría a archivos que no existen. El original
    // recién subido es el que se encola: es el mismo contenido.
    private bool NeedsProcessingAgain(VideoAsset video) => video.Status switch
    {
        VideoStatus.Failed => true,
        VideoStatus.Ready => !storage.HasAllFiles(video),
        _ => false,
    };
}
