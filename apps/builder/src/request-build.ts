// Pide un build al servicio, desde dentro de su contenedor (el token ya está en el entorno). Lo usa infra/restore.sh:
// tras restaurar una base vieja, el sitio publicado tiene que volver a salir de ella.
//
//   docker compose exec builder node src/request-build.ts
import { localUrl } from './config.ts';

try {
  const response = await fetch(localUrl('/build'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUILDER_TOKEN ?? ''}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 202) throw new Error(`POST /build respondió ${response.status}`);
  console.log('build pedido');
} catch (error) {
  console.error(`no se pudo pedir el build: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
