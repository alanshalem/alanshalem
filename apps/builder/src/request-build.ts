// Requests a build from the service, inside its container (the token is already in the environment). Used by
// infra/restore.sh: after restoring an older database, the published site has to be rebuilt from it.
//
//   docker compose exec builder node src/request-build.ts
import { localUrl } from './config.ts';

try {
  const response = await fetch(localUrl('/build'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUILDER_TOKEN ?? ''}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 202) throw new Error(`POST /build answered ${response.status}`);
  console.log('build requested');
} catch (error) {
  console.error(`could not request a build: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
