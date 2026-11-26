import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Guardas de regresión sobre los compose y los Dockerfiles. Son de texto (sin dependencias ni Docker): la validación
// real es `docker compose config -q` y levantar la copia local (skill docker-and-deploy).
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const exists = (path: string): boolean => existsSync(new URL(`../../${path}`, import.meta.url));

const prod = read('infra/docker-compose.yml');
const dev = read('infra/compose.dev.yml');

/** Líneas significativas (sin comentarios ni vacías), con su sangría. */
const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
const indent = (line: string): number => line.length - line.trimStart().length;

/** El bloque YAML que empieza en la línea `key:` con esa sangría (sin la línea de la clave), como texto. */
function block(text: string, key: string, depth = 0): string {
  const all = lines(text);
  const start = all.findIndex((line) => indent(line) === depth && line.trim().startsWith(`${key}:`));
  assert.ok(start >= 0, `falta ${key}`);
  const body: string[] = [];
  for (const line of all.slice(start + 1)) {
    if (indent(line) <= depth) break;
    body.push(line);
  }
  return body.join('\n');
}

/** Nombres de los servicios de un compose. */
const services = (text: string): string[] =>
  lines(block(text, 'services'))
    .filter((line) => indent(line) === 2)
    .map((line) => line.trim().replace(/:$/, ''));
const service = (text: string, name: string): string => block(block(text, 'services'), name, 2);

describe('docker-compose.yml (VPS)', () => {
  const all = services(prod);

  it('tiene los cuatro servicios', () => {
    assert.deepEqual(all, ['init-permisos', 'caddy', 'api', 'builder']);
  });

  it('los logs de Docker tienen tope (driver local, 5 × 10 MB) y lo usan todos los servicios', () => {
    assert.match(block(prod, 'x-logging'), /driver: local\n\s+options:\n\s+max-size: 10m\n\s+max-file: "5"/);
    assert.match(block(prod, 'x-service'), /logging: \*logging/);
    for (const name of all) assert.match(service(prod, name), /<<: \*service/, name);
  });

  it('endurecimiento común: no-new-privileges, sin capacidades y con tope de procesos', () => {
    const common = block(prod, 'x-service');
    assert.match(common, /security_opt:\n\s+- no-new-privileges:true/);
    assert.match(common, /cap_drop:\n\s+- ALL/);
    assert.match(common, /pids_limit: \d+/);
  });

  it('cada servicio agrega solo las capacidades que necesita', () => {
    const capAdd = (name: string): string[] => {
      const text = service(prod, name);
      if (!/cap_add:/.test(text)) return [];
      return lines(block(text, 'cap_add', 4)).map((line) => line.trim().replace(/^- /, ''));
    };
    assert.deepEqual(capAdd('caddy'), ['NET_BIND_SERVICE']);
    assert.deepEqual(capAdd('init-permisos'), ['CHOWN', 'DAC_OVERRIDE']);
    assert.deepEqual(capAdd('api'), []);
    assert.deepEqual(capAdd('builder'), []);
  });

  it('API, Caddy e init-permisos con el sistema de archivos de solo lectura; API y Caddy con /tmp en memoria', () => {
    for (const name of ['api', 'caddy', 'init-permisos']) assert.match(service(prod, name), /read_only: true/, name);
    for (const name of ['api', 'caddy']) assert.match(block(service(prod, name), 'tmpfs', 4), /- \/tmp\b/, name);
  });

  it('los temporales de la API (subidas, libvips) van al volumen /data y no a la RAM del contenedor', () => {
    assert.match(prod, /^x-api-tmp: &api-tmp \/data\/tmp$/m);
    const api = service(prod, 'api');
    assert.match(api, /ASPNETCORE_TEMP: \*api-tmp/);
    assert.match(api, /TMPDIR: \*api-tmp/);
    assert.match(api, /- api_data:\/data$/m);
    // init-permisos crea la carpeta antes de que arranque la API (ASP.NET no la crea).
    assert.match(service(prod, 'init-permisos'), /mkdir -p \/data\/tmp/);
  });

  it('init-permisos solo cambia el dueño de lo que tiene otro (no un chown -R de toda la media en cada up)', () => {
    const init = service(prod, 'init-permisos');
    assert.doesNotMatch(init, /chown -R/);
    assert.match(init, /find \/data \/media \\\( ! -user 1654 -o ! -group 1654 \\\) -exec chown -h 1654:1654 \{\} \+/);
    assert.match(init, /find \/site \\\( ! -user 1000 -o ! -group 1000 \\\) -exec chown -h 1000:1000 \{\} \+/);
  });

  it('healthchecks reales: la API con su modo healthcheck (L10) y el builder con su script, sin curl', () => {
    assert.match(service(prod, 'api'), /test: \["CMD", "dotnet", "Blog\.Api\.dll", "healthcheck"\]/);
    assert.match(service(prod, 'builder'), /test: \["CMD", "node", "src\/healthcheck\.ts"\]/);
    assert.ok(exists('apps/builder/src/healthcheck.ts'));
    // Las rutas relativas de los healthchecks dependen del WORKDIR de cada imagen.
    assert.match(read('apps/api/Dockerfile'), /WORKDIR \/app\n[\s\S]*ENTRYPOINT \["dotnet", "Blog\.Api\.dll"\]/);
    assert.match(read('apps/builder/Dockerfile'), /WORKDIR \/app\/apps\/builder\nCMD \["node", "src\/server\.ts"\]/);
    for (const name of ['api', 'builder']) assert.match(service(prod, name), /<<: \*healthcheck/, name);
    assert.match(block(prod, 'x-healthcheck'), /start_period: \d+s\n\s+start_interval: 2s/);
  });

  it('el builder espera a la API sana; Caddy también, pero arranca igual si la API no (el sitio no depende de ella)', () => {
    assert.match(block(service(prod, 'builder'), 'depends_on', 4), /api:\n\s+condition: service_healthy$/m);
    assert.match(block(service(prod, 'caddy'), 'depends_on', 4), /api:\n\s+condition: service_healthy\n\s+required: false/);
  });

  it('logs de la API en JSON', () => {
    assert.match(service(prod, 'api'), /Logging__Console__FormatterName: json/);
  });

  it('el correo de ACME es opcional: Caddy recibe la opción entera o nada', () => {
    assert.match(service(prod, 'caddy'), /CADDY_ACME_EMAIL: \$\{ACME_EMAIL:\+email \$\{ACME_EMAIL\}\}/);
    assert.match(read('infra/caddy/Caddyfile'), /^\{\n\t\{\$CADDY_ACME_EMAIL\}\n\}$/m);
  });

  it('sin SITE_NAME / SITE_TAGLINE / SITE_AUTHOR: el sitio los lee de la API', () => {
    for (const text of [prod, dev, read('infra/compose.local.yml')]) assert.doesNotMatch(text, /SITE_(NAME|TAGLINE|AUTHOR)/);
  });

  it('la imagen de init-permisos está fijada por digest', () => {
    assert.match(service(prod, 'init-permisos'), /image: busybox:[\d.]+@sha256:[0-9a-f]{64}/);
  });
});

describe('compose.dev.yml', () => {
  it('logs con tope en todos los servicios (directo o por el ancla x-node)', () => {
    assert.match(block(dev, 'x-node'), /logging: \*logging/);
    assert.match(block(dev, 'x-logging'), /driver: local/);
    for (const name of services(dev)) assert.match(service(dev, name), /logging: \*logging|<<: \*node/, name);
  });
});

describe('Dockerfiles', () => {
  const dockerfiles = ['apps/api/Dockerfile', 'apps/builder/Dockerfile', 'infra/caddy/Dockerfile'];
  /** Imagen de cada FROM, con los ARG resueltos. */
  const bases = (text: string): string[] => {
    const args = Object.fromEntries([...text.matchAll(/^ARG (\w+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
    const stages = new Set([...text.matchAll(/^FROM .* AS (\S+)$/gm)].map((m) => m[1]));
    return [...text.matchAll(/^FROM (\S+)/gm)]
      .map((m) => m[1]!.replace(/^\$\{(\w+)\}$/, (_, name: string) => args[name] ?? name))
      .filter((image) => !stages.has(image));
  };

  it('toda imagen base está fijada por digest', () => {
    for (const path of dockerfiles) {
      const images = bases(read(path));
      assert.ok(images.length > 0, path);
      for (const image of images) assert.match(image, /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/, `${path}: ${image}`);
    }
  });

  it('el mismo Node en el builder y en la imagen de Caddy (que compila el admin)', () => {
    const node = (path: string): string | undefined => /^ARG NODE_IMAGE=(\S+)$/m.exec(read(path))?.[1];
    assert.ok(node('apps/builder/Dockerfile'));
    assert.equal(node('infra/caddy/Dockerfile'), node('apps/builder/Dockerfile'));
  });

  it('la imagen del builder no lleva gestores de paquetes y solo instala dependencias de producción', () => {
    const builder = read('apps/builder/Dockerfile');
    const runtime = builder.slice(builder.lastIndexOf('\nFROM '));
    assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules/);
    assert.match(runtime, /\/usr\/local\/bin\/npm /);
    assert.doesNotMatch(runtime, /pnpm|corepack enable/);
    assert.match(builder, /pnpm install --frozen-lockfile --prod /);
    // Sin pnpm en la imagen, el build corre el binario de node_modules.
    assert.match(read('apps/builder/src/build.ts'), /'node_modules\/\.bin\/astro', 'build'/);
  });

  it('el admin se precomprime con el script del builder, no con código inline', () => {
    const caddy = read('infra/caddy/Dockerfile');
    assert.match(caddy, /^RUN node apps\/builder\/src\/precompress\.ts apps\/admin\/dist$/m);
    assert.doesNotMatch(caddy, /node .*-e /);
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(read('package.json')) as { packageManager: string; engines: { node: string }; scripts: Record<string, string> };

  it('pnpm ≥ 10.34.5 (versiones anteriores con CVE) y Node ≥ 22.18 (corre .ts sin compilar)', () => {
    const [, major, minor, patch] = /^pnpm@(\d+)\.(\d+)\.(\d+)$/.exec(pkg.packageManager)!.map(Number);
    assert.ok(major! > 10 || (major === 10 && (minor! > 34 || (minor === 34 && patch! >= 5))), pkg.packageManager);
    assert.equal(pkg.engines.node, '>=22.18');
  });

  it('`pnpm test` incluye estos tests', () => {
    assert.equal(pkg.scripts['test:infra'], 'node --test "infra/test/*.test.ts"');
    assert.match(pkg.scripts.test!, /pnpm test:infra/);
  });
});
