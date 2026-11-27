import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LIMITS } from '../src/limits.ts';

/*
 * The admin warns before sending with the same limits the API validates. So they do not drift apart again, this test
 * reads the domain constants in C# (the authority) and compares them with src/limits.ts: changing a number on either
 * side without the other breaks it.
 */

const DOMAIN = new URL('../../api/src/Blog.Domain/', import.meta.url);

const source = (file: string): string => readFileSync(new URL(file, DOMAIN), 'utf8');

/** `public const int MaxTitleLength = 200;` (also `private`, `double` and `500_000`). */
function constant(file: string, name: string): number {
  const match = new RegExp(`\\bconst\\s+(?:int|double)\\s+${name}\\s*=\\s*([\\d_.]+)\\s*;`).exec(source(file));
  assert.ok(match?.[1], `constant ${name} not found in ${file}: was it renamed in the API?`);
  return Number(match[1].replaceAll('_', ''));
}

/** `FadeDurations { get; } = [0.5, 1, 2];` */
function numberList(file: string, name: string): number[] {
  const match = new RegExp(`\\b${name}\\s*\\{\\s*get;\\s*\\}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source(file));
  assert.ok(match?.[1], `list ${name} not found in ${file}`);
  return match[1].split(',').map((item) => Number(item.trim()));
}

describe('LIMITS: the same numbers as the API domain', () => {
  it('post (PostContent, Slug)', () => {
    assert.deepEqual(LIMITS.post, {
      title: constant('PostContent.cs', 'MaxTitleLength'),
      slug: constant('Slug.cs', 'MaxLength'),
      summary: constant('PostContent.cs', 'MaxSummaryLength'),
      coverAlt: constant('PostContent.cs', 'MaxCoverAltLength'),
    });
  });

  it('site settings (SiteSettingsContent) and URLs (WebUrl)', () => {
    assert.deepEqual(LIMITS.settings, {
      name: constant('SiteSettings.cs', 'MaxNameLength'),
      tagline: constant('SiteSettings.cs', 'MaxTaglineLength'),
      bio: constant('SiteSettings.cs', 'MaxBioLength'),
      email: constant('SiteSettings.cs', 'MaxEmailLength'),
    });
    assert.equal(LIMITS.url, constant('WebUrl.cs', 'MaxLength'));
  });

  it('hero item texts (HeroImageContent)', () => {
    assert.deepEqual(LIMITS.heroImage, {
      alt: constant('HeroImage.cs', 'MaxAltLength'),
      credit: constant('HeroImage.cs', 'MaxCreditLength'),
    });
  });

  it('hero size (HeroFrame), with the minimum aspect as an integer fraction', () => {
    assert.deepEqual(LIMITS.heroFrame, {
      ideal: { width: constant('HeroFrame.cs', 'IdealWidth'), height: constant('HeroFrame.cs', 'IdealHeight') },
      min: { width: constant('HeroFrame.cs', 'MinWidth'), height: constant('HeroFrame.cs', 'MinHeight') },
      minAspect: {
        numerator: constant('HeroFrame.cs', 'MinAspectNumerator'),
        denominator: constant('HeroFrame.cs', 'MinAspectDenominator'),
      },
    });
  });

  it('video trim and fade (VideoEdit)', () => {
    assert.deepEqual(LIMITS.video, {
      minSeconds: constant('VideoEdit.cs', 'MinSeconds'),
      maxSeconds: constant('VideoEdit.cs', 'MaxSeconds'),
      fadeSeconds: numberList('VideoEdit.cs', 'FadeDurations'),
      defaultFadeSeconds: constant('VideoEdit.cs', 'DefaultFadeSeconds'),
    });
  });

  it('the constant reader finds what it looks for and fails if it does not exist', () => {
    assert.equal(constant('PostContent.cs', 'MaxBodyLength'), 500_000);
    assert.throws(() => constant('PostContent.cs', 'Missing'), /constant Missing not found/);
  });
});

describe('no stray limit number outside src/limits.ts', () => {
  // The inputs' `maxLength` used to be literals (200, 120, 400, 300): they must come from LIMITS.
  for (const file of ['pages/PostEditorPage.tsx', 'components/ImageField.tsx', 'hero/HeroImageForm.tsx', 'pages/SettingsPage.tsx', 'settings/BioField.tsx']) {
    it(file, () => {
      const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      assert.deepEqual(text.match(/maxLength=\{\d+\}/g) ?? [], []);
    });
  }
});
