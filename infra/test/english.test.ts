import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { it } from 'node:test';

// English is the repository standard: operator- and developer-facing infra and CI files carry no Spanish. A Spanish
// accent or inverted mark is the cheap, reliable signal (Spanish UI text never lives in these files).
const root = new URL('../../', import.meta.url);
const files = [
  '.trivyignore',
  '.github/dependabot.yml',
  'apps/api/Dockerfile',
  'apps/builder/Dockerfile',
  'infra/caddy/Caddyfile',
  'infra/caddy/Dockerfile',
  'infra/compose.dev.yml',
  'infra/compose.dokploy.yml',
  'infra/compose.local.yml',
  'infra/docker-compose.yml',
  'infra/local.env',
  ...readdirSync(new URL('infra/', root))
    .filter((name) => name.endsWith('.sh'))
    .map((name) => `infra/${name}`),
  ...readdirSync(new URL('.github/workflows/', root)).map((name) => `.github/workflows/${name}`),
];

it('infra and CI files are written in English', () => {
  for (const file of files) {
    readFileSync(new URL(file, root), 'utf8')
      .split('\n')
      .forEach((line, index) => assert.doesNotMatch(line, /[áéíóúñ¿¡ÁÉÍÓÚÑ]/, `${file}:${index + 1}`));
  }
});
