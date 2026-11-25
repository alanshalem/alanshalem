import { createServer } from 'node:http';
import { isAuthorized } from './auth.ts';
import { buildAndActivate, type BuildResult } from './build.ts';
import { loadConfig } from './config.ts';
import { BuildQueue } from './queue.ts';
import { activeReleaseName } from './releases.ts';

const config = loadConfig();

interface BuildStatus {
  at: string;
  ok: boolean;
  detail: string;
}
let lastBuild: BuildStatus | undefined;

const log = (message: string): void => console.log(`[builder] ${new Date().toISOString()} ${message}`);

const queue = new BuildQueue(
  async () => {
    log('construyendo el sitio…');
    const result: BuildResult = await buildAndActivate(config);
    lastBuild = {
      at: new Date().toISOString(),
      ok: true,
      detail: `${result.release.split('/').pop()} en ${(result.durationMs / 1000).toFixed(1)} s, ${result.compressedFiles} archivos precomprimidos`,
    };
    log(`publicado: ${lastBuild.detail}`);
  },
  config.debounceMs,
  (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    lastBuild = { at: new Date().toISOString(), ok: false, detail };
    log(`el build falló; el sitio publicado no cambió.\n${detail}`);
  },
);

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const { method, url } = request;

  // No hace falta leer cuerpos: ningún endpoint los usa. Descartarlos evita que un cliente cuelgue la conexión.
  request.resume();

  if (method === 'GET' && url === '/health') {
    return sendJson(response, 200, { status: 'ok', busy: queue.isBusy });
  }

  if (!isAuthorized(request.headers.authorization, config.token)) {
    return sendJson(response, 401, { error: 'unauthorized' });
  }

  if (method === 'POST' && url === '/build') {
    queue.request();
    // 202: pedido aceptado; el build ocurre en segundo plano.
    return sendJson(response, 202, { queued: true });
  }

  if (method === 'GET' && url === '/status') {
    return void activeReleaseName(config.siteDir).then((active) =>
      sendJson(response, 200, { active: active ?? null, busy: queue.isBusy, lastBuild: lastBuild ?? null }),
    );
  }

  return sendJson(response, 404, { error: 'not found' });
});

/**
 * Primer arranque: si todavía no hay sitio publicado, se construye uno. La API puede tardar unos segundos
 * en estar lista (docker compose los levanta a la vez), así que se reintenta con espera.
 */
async function ensureInitialSite(): Promise<void> {
  if (await activeReleaseName(config.siteDir)) return;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    queue.request();
    await queue.whenIdle();
    if (lastBuild?.ok) return;
    log(`el build inicial falló (intento ${attempt}/6); reintento en 10 s`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  log('no se pudo hacer el build inicial. Publicá un post o llamá a POST /build para reintentar.');
}

server.listen(config.port, () => {
  log(`escuchando en :${config.port}`);
  void ensureInitialSite();
});

// Apagado ordenado: dejar de aceptar pedidos y esperar a que termine el build en curso.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log(`${signal} recibido, cerrando…`);
    server.close();
    void queue.whenIdle().then(() => process.exit(0));
  });
}
