import { createServer } from 'node:http';
import { isAuthorized } from './auth.ts';
import { buildAndActivate, type BuildResult } from './build.ts';
import { loadConfig } from './config.ts';
import { BuildQueue } from './queue.ts';
import { activeReleaseName } from './releases.ts';
import { buildOnStartup } from './startup.ts';
import { defaultVersionSources, resolveBuilderVersion } from './version.ts';

const config = loadConfig();
/** This builder's version: every release it builds is stamped with it (see startup.ts). */
const version = await resolveBuilderVersion(process.env, defaultVersionSources(config.webDir));

interface BuildStatus {
  at: string;
  ok: boolean;
  detail: string;
}
let lastBuild: BuildStatus | undefined;

const log = (message: string): void => console.log(`[builder] ${new Date().toISOString()} ${message}`);

const queue = new BuildQueue(
  async () => {
    log('building the site…');
    const result: BuildResult = await buildAndActivate(config, version);
    lastBuild = {
      at: new Date().toISOString(),
      ok: true,
      detail:
        `${result.release.split('/').pop()} in ${(result.durationMs / 1000).toFixed(1)} s, ` +
        `${result.compressedFiles} files precompressed`,
    };
    log(`published: ${lastBuild.detail}`);
  },
  config.debounceMs,
  (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    lastBuild = { at: new Date().toISOString(), ok: false, detail };
    log(`build failed; the published site did not change.\n${detail}`);
  },
);

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const { method, url } = request;

  // No need to read bodies: no endpoint uses them. Discarding them keeps a client from hanging the connection.
  request.resume();

  if (method === 'GET' && url === '/health') {
    return sendJson(response, 200, { status: 'ok', busy: queue.isBusy });
  }

  if (!isAuthorized(request.headers.authorization, config.token)) {
    return sendJson(response, 401, { error: 'unauthorized' });
  }

  if (method === 'POST' && url === '/build') {
    queue.request();
    // 202: request accepted; the build runs in the background.
    return sendJson(response, 202, { queued: true });
  }

  if (method === 'GET' && url === '/status') {
    return void activeReleaseName(config.siteDir).then((active) =>
      sendJson(response, 200, { active: active ?? null, version, busy: queue.isBusy, lastBuild: lastBuild ?? null }),
    );
  }

  return sendJson(response, 404, { error: 'not found' });
});

server.listen(config.port, () => {
  log(`listening on :${config.port} (builder ${version})`);
  // No site yet, or one built by another builder version (a new image): build it, with retries (startup.ts).
  void buildOnStartup(config.siteDir, version, queue, () => lastBuild?.ok === true, { log });
});

// Orderly shutdown: stop accepting requests and wait for the running build to finish.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down…`);
    server.close();
    void queue.whenIdle().then(() => process.exit(0));
  });
}
