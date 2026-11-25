// Copia las fuentes self-hosted a public/fonts con los nombres que espera tokens.css.
//   pnpm --filter @blog/web fonts
//
// Gloock y Hanken Grotesk salen de los paquetes @fontsource (licencia OFL).
// Pagella (TeX Gyre Pagella, licencia GUST) NO está en npm: ya está versionada en public/fonts (ver LICENSES.txt).
// Para regenerarla, bajarla de
// https://www.gust.org.pl/projects/e-foundry/tex-gyre/pagella, convertir los .otf a woff2
// y dejarlos como pagella-regular-latin.woff2, pagella-italic-latin.woff2 y pagella-bold-latin.woff2.
// Sin ellos el sitio funciona igual: la pila de fuentes cae a Palatino / Georgia.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const outDir = join(import.meta.dirname, '..', 'public', 'fonts');
mkdirSync(outDir, { recursive: true });

const fonts = [
  ['@fontsource/gloock/files/gloock-latin-400-normal.woff2', 'gloock-latin.woff2'],
  ['@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2', 'hanken-grotesk-latin.woff2'],
];

for (const [source, target] of fonts) {
  const packageName = source.split('/').slice(0, 2).join('/');
  const packageDir = dirname(require.resolve(`${packageName}/package.json`));
  const file = join(packageDir, source.slice(packageName.length + 1));
  if (!existsSync(file)) {
    console.error(`No se encontró ${source} (¿cambió el nombre del archivo en @fontsource?)`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(file, join(outDir, target));
  console.log(`✓ ${target}`);
}

for (const pagella of ['regular', 'italic', 'bold']) {
  if (!existsSync(join(outDir, `pagella-${pagella}-latin.woff2`))) {
    console.warn(`⚠ Falta pagella-${pagella}-latin.woff2 (ver instrucciones arriba).`);
  }
}
