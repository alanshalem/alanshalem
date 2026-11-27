// Copies the self-hosted fonts to public/fonts with the names tokens.css expects.
//   pnpm --filter @blog/web fonts
//
// Gloock and Hanken Grotesk come from the @fontsource packages (OFL license).
// Pagella (TeX Gyre Pagella, GUST license) is NOT on npm: it is already committed in public/fonts (see LICENSES.txt).
// To regenerate it, download it from
// https://www.gust.org.pl/projects/e-foundry/tex-gyre/pagella, convert the .otf files to woff2
// and save them as pagella-regular-latin.woff2, pagella-italic-latin.woff2 and pagella-bold-latin.woff2.
// Without them the site works all the same: the font stack falls back to Palatino / Georgia.
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
    console.error(`${source} not found (did the file name change in @fontsource?)`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(file, join(outDir, target));
  console.log(`✓ ${target}`);
}

for (const pagella of ['regular', 'italic', 'bold']) {
  if (!existsSync(join(outDir, `pagella-${pagella}-latin.woff2`))) {
    console.warn(`⚠ pagella-${pagella}-latin.woff2 is missing (see the instructions above).`);
  }
}
