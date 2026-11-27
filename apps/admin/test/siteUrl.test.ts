import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SITE_URL } from '../src/siteUrl.ts';

describe('SITE_URL', () => {
  it('without a URL injected by Vite (production build, tests) it points to the root of the same domain', () => {
    assert.equal(SITE_URL, '/');
  });
});
