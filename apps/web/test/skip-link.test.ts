import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

const layout = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

it('the skip link targets the id of the main landmark', () => {
  const target = /class="skip-link" href="#([\w-]+)"/.exec(layout)?.[1];
  assert.equal(target, 'main-content');
  assert.match(layout, new RegExp(`<main id="${target}"`));
});
