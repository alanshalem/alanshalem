// Healthcheck de compose: la imagen no trae curl ni wget, así que se pregunta con el propio Node. Sale con 0 si el
// servicio responde GET /health, con 1 si no (lo mismo que hace `dotnet Blog.Api.dll healthcheck` en la API).
import { localUrl } from './config.ts';

try {
  const response = await fetch(localUrl('/health'), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`/health respondió ${response.status}`);
} catch (error) {
  console.error(`builder no saludable: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
