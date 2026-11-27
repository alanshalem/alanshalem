// Compose healthcheck: the image has no curl or wget, so Node itself asks. Exits with 0 when the service answers
// GET /health, with 1 otherwise (the same as `dotnet Blog.Api.dll healthcheck` does in the API).
import { localUrl } from './config.ts';

try {
  const response = await fetch(localUrl('/health'), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`/health answered ${response.status}`);
} catch (error) {
  console.error(`builder unhealthy: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
