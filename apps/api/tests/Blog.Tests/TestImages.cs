using System.Buffers.Binary;
using NetVips;

namespace Blog.Tests;

/// <summary>Imágenes generadas en memoria para probar el pipeline (no hay archivos binarios en el repo).</summary>
internal static class TestImages
{
    /// <summary>Degradé suave en sRGB: se parece a una foto (sin bordes duros) y se codifica rápido.</summary>
    public static Image Gradient(int width, int height)
    {
        using var coordinates = Image.Xyz(width, height);
        using var x = coordinates[0];
        using var y = coordinates[1];
        using var red = x * (255.0 / width);
        using var green = y * (255.0 / height);
        using var blue = (x + y) * (127.0 / (width + height)) + 64;
        using var bands = red.Bandjoin(green, blue);
        return bands.Cast(Enums.BandFormat.Uchar).Copy(interpretation: Enums.Interpretation.Srgb);
    }

    /// <summary>Un solo valor = escala de grises; tres = sRGB.</summary>
    public static Image Solid(int width, int height, params double[] channels)
    {
        using var black = Image.Black(width, height, bands: channels.Length);
        using var colored = black + channels;
        var interpretation = channels.Length == 1 ? Enums.Interpretation.Bw : Enums.Interpretation.Srgb;
        return colored.Cast(Enums.BandFormat.Uchar).Copy(interpretation: interpretation);
    }

    public static byte[] Jpeg(Image image) => image.JpegsaveBuffer(q: 90, keep: Enums.ForeignKeep.None);

    public static byte[] Png(Image image) => image.PngsaveBuffer(keep: Enums.ForeignKeep.None);

    /// <summary>GIF animado: un cuadro liso por color, de 100 ms cada uno.</summary>
    public static byte[] AnimatedGif(int width, int height, params double[][] frameColors)
    {
        var frames = frameColors.Select(color => Solid(width, height, color)).ToArray();
        try
        {
            // libvips representa una animación como una tira vertical de cuadros con "page-height".
            using var strip = Image.Arrayjoin(frames, across: 1);
            using var animated = strip.Mutate(image =>
            {
                image.Set(GValue.GIntType, "page-height", height);
                image.Set(GValue.ArrayIntType, "delay", Enumerable.Repeat(100, frames.Length).ToArray());
                image.Set(GValue.GIntType, "loop", 0);
            });
            return animated.GifsaveBuffer(keep: Enums.ForeignKeep.None);
        }
        finally
        {
            foreach (var frame in frames)
            {
                frame.Dispose();
            }
        }
    }

    /// <summary>
    /// JPEG con un bloque EXIF armado a mano: orientación 6 (la cámara estaba girada 90°) y coordenadas GPS.
    /// Se arma byte a byte para que la prueba no dependa de cómo escribe EXIF la misma biblioteca que se prueba.
    /// </summary>
    public static byte[] JpegWithGpsAndOrientation(Image image)
    {
        var jpeg = Jpeg(image);
        var exif = ExifSegment(orientation: 6, latitude: [40, 26, 46]);
        // El segmento APP1 va justo después del marcador de inicio (FF D8).
        return [.. jpeg.AsSpan(0, 2), .. exif, .. jpeg.AsSpan(2)];
    }

    private static byte[] ExifSegment(ushort orientation, uint[] latitude)
    {
        const int ifd0Offset = 8;
        const int ifd0Size = 2 + (2 * 12) + 4;
        const int gpsOffset = ifd0Offset + ifd0Size;
        const int gpsSize = 2 + (2 * 12) + 4;
        const int latitudeOffset = gpsOffset + gpsSize;

        var tiff = new byte[latitudeOffset + (latitude.Length * 8)];
        var span = tiff.AsSpan();
        "II"u8.CopyTo(span);
        BinaryPrimitives.WriteUInt16LittleEndian(span[2..], 42);
        BinaryPrimitives.WriteUInt32LittleEndian(span[4..], ifd0Offset);

        // IFD0: orientación + puntero a la sub-IFD de GPS.
        BinaryPrimitives.WriteUInt16LittleEndian(span[ifd0Offset..], 2);
        WriteEntry(span[(ifd0Offset + 2)..], tag: 0x0112, type: 3, count: 1, value: orientation);
        WriteEntry(span[(ifd0Offset + 14)..], tag: 0x8825, type: 4, count: 1, value: gpsOffset);

        // GPS: hemisferio "N" + latitud en grados, minutos, segundos (racionales n/1).
        BinaryPrimitives.WriteUInt16LittleEndian(span[gpsOffset..], 2);
        WriteEntry(span[(gpsOffset + 2)..], tag: 0x0001, type: 2, count: 2, value: 'N');
        WriteEntry(span[(gpsOffset + 14)..], tag: 0x0002, type: 5, count: (uint)latitude.Length, value: latitudeOffset);
        for (var index = 0; index < latitude.Length; index++)
        {
            BinaryPrimitives.WriteUInt32LittleEndian(span[(latitudeOffset + (index * 8))..], latitude[index]);
            BinaryPrimitives.WriteUInt32LittleEndian(span[(latitudeOffset + (index * 8) + 4)..], 1);
        }

        byte[] payload = [.. "Exif\0\0"u8, .. tiff];
        var segment = new byte[4 + payload.Length];
        segment[0] = 0xFF;
        segment[1] = 0xE1;
        BinaryPrimitives.WriteUInt16BigEndian(segment.AsSpan(2), (ushort)(2 + payload.Length));
        payload.CopyTo(segment.AsSpan(4));
        return segment;
    }

    private static void WriteEntry(Span<byte> entry, ushort tag, ushort type, uint count, uint value)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(entry, tag);
        BinaryPrimitives.WriteUInt16LittleEndian(entry[2..], type);
        BinaryPrimitives.WriteUInt32LittleEndian(entry[4..], count);
        BinaryPrimitives.WriteUInt32LittleEndian(entry[8..], value);
    }
}
