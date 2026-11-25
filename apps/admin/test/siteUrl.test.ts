import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SITE_URL } from '../src/siteUrl.ts';

describe('SITE_URL', () => {
  it('sin URL inyectada por Vite (build de producción, tests) apunta a la raíz del mismo dominio', () => {
    assert.equal(SITE_URL, '/');
  });
});
