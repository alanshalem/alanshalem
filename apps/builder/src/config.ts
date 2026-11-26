export interface BuilderConfig {
  port: number;
  /** Secreto compartido con la API (mismo valor que Builder__Token allá). */
  token: string;
  /** Carpeta que contiene `releases/` y el symlink `current`. Caddy sirve `current`. */
  siteDir: string;
  /** Carpeta del proyecto Astro (apps/web). */
  webDir: string;
  apiUrl: string;
  siteUrl: string;
  keepReleases: number;
  /** Espera antes de construir, para juntar varios guardados seguidos en una sola construcción. */
  debounceMs: number;
  buildTimeoutMs: number;
}

const MIN_TOKEN_LENGTH = 32;
const DEFAULT_PORT = 4000;

/** URL del propio servicio desde su contenedor, para los scripts que le hablan (healthcheck, pedir un build). */
export const localUrl = (path: string, env: NodeJS.ProcessEnv = process.env): string =>
  `http://127.0.0.1:${env.PORT || DEFAULT_PORT}${path}`;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} debe ser un entero positivo (recibido: "${raw}").`);
  return value;
}

/** Lee la configuración del entorno. Falla al arrancar si falta algo, no a mitad de un build. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BuilderConfig {
  const token = required(env, 'BUILDER_TOKEN');
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`BUILDER_TOKEN debe tener al menos ${MIN_TOKEN_LENGTH} caracteres (openssl rand -hex 32).`);
  }

  return {
    port: positiveInt(env, 'PORT', DEFAULT_PORT),
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
