import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { ProfileData } from '../src/model.ts';
import { renderProfile } from '../src/profile.ts';
import { TEXT_COLORS } from '../src/theme.ts';

const fixture: ProfileData = JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8'));
const files = renderProfile(fixture);
const FILES = ['header.svg', 'stack.svg', 'project.svg', 'stats.svg', 'languages.svg', 'streak.svg', 'trophies.svg'];

/** Tag balance: enough for what the generator emits (no comments, CDATA or `>` in attributes). */
function assertWellFormed(svg: string, name: string): void {
  const stack: string[] = [];
  for (const [, closing, tag, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (!closing) stack.push(tag!);
    else assert.equal(stack.pop(), tag, `${name}: </${tag}> never opened`);
  }
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
}

const descOf = (svg: string): string => svg.match(/<desc id="desc">([^<]*)<\/desc>/)?.[1] ?? '';

describe('renderProfile', () => {
  it('generates the seven profile images', () => {
    assert.deepEqual(Object.keys(files), FILES);
  });

  for (const name of FILES) {
    it(`${name}: self-contained, accessible and light SVG (GitHub camo rules)`, () => {
      const svg = files[name]!;
      assertWellFormed(svg, name);
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+" role="img" aria-labelledby="title desc">/);
      assert.match(svg, /<title id="title">[^<]+<\/title><desc id="desc">[^<]+<\/desc>/);
      assert.doesNotMatch(svg, /<script|foreignObject|<image|@import|url\((?!#)|javascript:/i);
      for (const [, href] of svg.matchAll(/href="([^"]*)"/g)) {
        assert.match(href!, /^#/, `${name}: href externo ${href}`);
        assert.ok(svg.includes(`id="${href!.slice(1)}"`), `${name}: ${href} is not defined`);
      }
      assert.equal([...svg.matchAll(/http/g)].length, 1, `${name}: only the xmlns may hold a URL`);
      assert.ok(Buffer.byteLength(svg) < 60_000, `${name}: ${Buffer.byteLength(svg)} bytes`);
      if (/animation/.test(svg)) assert.match(svg, /@media \(prefers-reduced-motion: reduce\)\{\*\{animation:none!important\}\}/);
      for (const [, fill] of svg.matchAll(/<g fill="([^"]+)" transform/g)) {
        assert.ok(TEXT_COLORS.includes(fill!), `${name}: text in ${fill}, outside the colors with measured contrast`);
      }
    });
  }

  it('the header animates on entry and honors prefers-reduced-motion', () => {
    assert.match(files['header.svg']!, /animation:/);
    assert.match(descOf(files['header.svg']!), /Alan Shalem.*Engineer from Argentina/);
  });

  it('every data card describes its values in <desc> (the text is drawn as outlines)', () => {
    const n = (v: number): string => v.toLocaleString('en-US');
    const stats = descOf(files['stats.svg']!);
    for (const value of [fixture.stars, fixture.forks, fixture.commitsLastYear, fixture.pullRequests, fixture.issues, fixture.repos, fixture.followers]) {
      assert.ok(stats.includes(n(value)), `stats: falta ${value} en "${stats}"`);
    }
    assert.match(descOf(files['languages.svg']!), /^Top languages by code size: TypeScript \d+(\.\d)?%/);
    assert.match(descOf(files['streak.svg']!), /Total contributions: [\d,]+.*Current streak: \d+ days?.*Longest streak: \d+ days?/);
    assert.match(descOf(files['trophies.svg']!), /^Stars: (rank (C|B|A|AA|AAA|S)|unranked)/);
  });

  it('the calendar measures intensity against the busiest day of the 12 months it shows', () => {
    const svg = renderProfile({ ...fixture, contributions: { '2021-01-01': 1000, [fixture.fetchedAt.slice(0, 10)]: 4 } })['streak.svg']!;
    assert.match(svg, /fill="#9db2ff" fill-opacity="1"/);
  });

  it('escapes the API data in the XML', () => {
    const svg = renderProfile({ ...fixture, languages: { '<C&C>': 10 } })['languages.svg']!;
    assert.ok(svg.includes('&lt;C&amp;C&gt; 100%'));
    assert.ok(!svg.includes('<C&C>'));
  });

  it('is deterministic: the same data gives the same bytes (the Action only commits when something changed)', () => {
    assert.deepEqual(renderProfile(fixture), files);
  });
});
