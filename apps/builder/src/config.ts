export interface BuilderConfig {
  port: number;
  /** Secret shared with the API (the same value as Builder__Token there). */
  token: string;
  /** Folder holding `releases/` and the `current` symlink. Caddy serves `current`. */
  siteDir: string;
  /** Folder of the Astro project (apps/web). */
  webDir: string;
  apiUrl: string;
  siteUrl: string;
  keepReleases: number;
  /** Wait before building, to merge several saves in a row into one build. */
  debounceMs: number;
  buildTimeoutMs: number;
}

const MIN_TOKEN_LENGTH = 32;
const DEFAULT_PORT = 4000;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer (got: "${raw}").`);
  return value;
}

/** The service port: the server and the scripts that talk to it use it, so it is validated in one place. */
const portOf = (env: NodeJS.ProcessEnv): number => positiveInt(env, 'PORT', DEFAULT_PORT);

/** URL of the service itself from its container, for the scripts that talk to it (healthcheck, requesting a build). */
export const localUrl = (path: string, env: NodeJS.ProcessEnv = process.env): string =>
  `http://127.0.0.1:${portOf(env)}${path}`;

/** Reads the configuration from the environment. Fails at startup when something is missing, not halfway a build. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BuilderConfig {
  const token = required(env, 'BUILDER_TOKEN');
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`BUILDER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters long (openssl rand -hex 32).`);
  }

  return {
    port: portOf(env),
    token,
    siteDir: required(env, 'SITE_DIR'),
    webDir: required(env, 'WEB_DIR'),
    apiUrl: required(env, 'API_URL'),
    siteUrl: required(env, 'SITE_URL'),
    keepReleases: positiveInt(env, 'KEEP_RELEASES', 3),
    debounceMs: positiveInt(env, 'DEBOUNCE_MS', 2_000),
    buildTimeoutMs: positiveInt(env, 'BUILD_TIMEOUT_MS', 5 * 60_000),
  };
}
