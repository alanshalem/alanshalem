import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { absoluteUrl, site, yearOf } from '../src/lib/site.ts';

/*
 * The site URL comes from one place: `site` in astro.config.mjs, which builds it from SITE_URL.
 * lib/site.ts reads it from Astro (import.meta.env.SITE) instead of repeating the computation and its default.
 */

const SRC = new URL('../src/', import.meta.url);

const sourceFiles = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)],
  );

describe('site URL: a single source', () => {
  it('no file in src/ reads SITE_URL or repeats the astro.config.mjs default', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /process\.env\.SITE_URL|localhost:4321/.test(readFileSync(file, 'utf8')))
      .map((file) => file.pathname.slice(SRC.pathname.length));
    assert.deepEqual(offenders, []);
  });

  it('lib/site.ts takes `site` from the Astro config', () => {
    assert.match(readFileSync(new URL('lib/site.ts', SRC), 'utf8'), /import\.meta\.env\?\.SITE/);
  });

  it('outside Astro (these tests) it invents no URL: it stays empty and paths stay paths', () => {
    assert.equal(site.url, '');
    assert.equal(absoluteUrl('/es/'), '/es/');
  });
});

describe('yearOf: the year in the site time zone', () => {
  it('New Year’s Eve night in Buenos Aires is still the old year, whatever the UTC date', () => {
    assert.equal(yearOf(new Date('2027-01-01T02:30:00Z')), 2026);
    assert.equal(yearOf(new Date('2027-01-01T03:00:00Z')), 2027);
  });
});
