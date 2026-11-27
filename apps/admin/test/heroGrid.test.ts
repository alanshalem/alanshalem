import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HeroImage, MediaAsset, VideoAsset } from '../src/api/types.ts';
import {
  countHeroItems,
  focusAfterRemoval,
  HERO_FILTERS,
  heroCountText,
  heroTiles,
  missingEnglish,
  neighbors,
  panelLeaveConfirmation,
  tileLabel,
} from '../src/hero/heroGrid.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

const es = i18nFor('es');
const en = i18nFor('en');

/*
 * The hero thumbnail grid + side panel: with 50 items the list of large cards became huge. Pure rules: filter, count,
 * detect the missing English text and move between items.
 */

const media: MediaAsset = {
  id: 'm',
  url: '/media/m/1600.webp',
  width: 1920,
  height: 1080,
  color: '#111111',
  placeholder: 'data:image/webp;base64,AAAA',
  variants: [],
  createdAt: '2026-11-01T00:00:00Z',
};

const video = { id: 'v', status: 'ready', poster: media } as VideoAsset;

const item = (id: string, overrides: Partial<HeroImage> = {}): HeroImage => ({
  id,
  media,
  video: null,
  alt: `Alt ${id}`,
  credit: null,
  altEn: `English ${id}`,
  createdAt: '2026-11-01T00:00:00Z',
  ...overrides,
});

// 1 photo with English, 2 video without English, 3 photo without English (empty), 4 video with English, 5 photo with only spaces.
const images: HeroImage[] = [
  item('a'),
  item('b', { video, altEn: null }),
  item('c', { altEn: '' }),
  item('d', { video }),
  item('e', { altEn: '   ' }),
];

describe('missingEnglish: the English alt text is missing', () => {
  it('null, empty or only spaces = missing (the English site uses the Spanish one)', () => {
    assert.equal(missingEnglish({ altEn: null }), true);
    assert.equal(missingEnglish({ altEn: '' }), true);
    assert.equal(missingEnglish({ altEn: '  ' }), true);
  });

  it('with text it is not missing', () => {
    assert.equal(missingEnglish({ altEn: 'A lake' }), false);
  });
});

describe('heroTiles: filtering without losing the order number', () => {
  it('the filters, in the segmented control order', () => {
    assert.deepEqual(HERO_FILTERS, ['all', 'photo', 'video', 'missingEn']);
  });

  it('Todas: all of them, numbered from 1 in upload order', () => {
    assert.deepEqual(
      heroTiles(images, 'all').map(({ image, number }) => [image.id, number]),
      [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]],
    );
  });

  it('Fotos, Videos and Sin inglés keep the number of the full list', () => {
    assert.deepEqual(heroTiles(images, 'photo').map(({ image, number }) => [image.id, number]), [['a', 1], ['c', 3], ['e', 5]]);
    assert.deepEqual(heroTiles(images, 'video').map(({ image, number }) => [image.id, number]), [['b', 2], ['d', 4]]);
    assert.deepEqual(heroTiles(images, 'missingEn').map(({ image, number }) => [image.id, number]), [['b', 2], ['c', 3], ['e', 5]]);
  });

  it('each thumbnail knows whether it is a video and whether English is missing (the marks)', () => {
    assert.deepEqual(
      heroTiles(images, 'all').map(({ kind, missingEn }) => [kind, missingEn]),
      [['photo', false], ['video', true], ['photo', true], ['video', false], ['photo', true]],
    );
  });

  it('no matches: empty list (the view shows the short notice)', () => {
    assert.deepEqual(heroTiles([item('a')], 'video'), []);
    assert.deepEqual(heroTiles([], 'all'), []);
  });
});

describe('countHeroItems + heroCountText: "12 fotos · 3 videos"', () => {
  it('counts each filter', () => {
    assert.deepEqual(countHeroItems(images), { all: 5, photo: 3, video: 2, missingEn: 3 });
    assert.deepEqual(countHeroItems([]), { all: 0, photo: 0, video: 0, missingEn: 0 });
  });

  it('plural in Spanish and in English', () => {
    assert.equal(heroCountText(countHeroItems(images), es), '3 fotos · 2 videos');
    assert.equal(heroCountText(countHeroItems(images), en), '3 photos · 2 videos');
    assert.equal(heroCountText({ all: 2, photo: 1, video: 1, missingEn: 0 }, es), '1 foto · 1 video');
    assert.equal(heroCountText({ all: 2, photo: 1, video: 1, missingEn: 0 }, en), '1 photo · 1 video');
  });

  it('a missing kind is not named; with nothing, empty', () => {
    assert.equal(heroCountText({ all: 12, photo: 12, video: 0, missingEn: 0 }, es), '12 fotos');
    assert.equal(heroCountText({ all: 3, photo: 0, video: 3, missingEn: 0 }, en), '3 videos');
    assert.equal(heroCountText(countHeroItems([]), es), '');
  });
});

describe('tileLabel: accessible name of the thumbnail (WCAG 2.5.3 and 1.1.1)', () => {
  const [a, b, c] = heroTiles(images, 'all');

  it('starts with the visible number, continues with the alt text and names the visible marks', () => {
    assert.equal(tileLabel(a!, es), '1. Alt a');
    assert.equal(tileLabel(b!, es), '2. Alt b · Video · Sin inglés');
    assert.equal(tileLabel(c!, es), '3. Alt c · Sin inglés');
    assert.equal(tileLabel(b!, en), '2. Alt b · Video · No English');
  });

  it('the marks use the same texts that are shown (and the filter uses)', () => {
    for (const i18n of [es, en]) {
      const label = tileLabel(b!, i18n);
      assert.ok(label.startsWith('2. '), label);
      assert.ok(label.includes(i18n.t('hero.badge.video')), label);
      assert.ok(label.includes(i18n.t('hero.filter.missingEn')), label);
    }
  });
});

describe('neighbors: previous and next inside the panel', () => {
  const ids = ['a', 'b', 'c'];

  it('in the middle there are both; the position counts from 1', () => {
    assert.deepEqual(neighbors(ids, 'b'), { previous: 'a', next: 'c', position: 2, total: 3 });
  });

  it('at the ends it does not wrap', () => {
    assert.deepEqual(neighbors(ids, 'a'), { previous: null, next: 'b', position: 1, total: 3 });
    assert.deepEqual(neighbors(ids, 'c'), { previous: 'b', next: null, position: 3, total: 3 });
  });

  it('a single one, or an id no longer there: no neighbors', () => {
    assert.deepEqual(neighbors(['a'], 'a'), { previous: null, next: null, position: 1, total: 1 });
    assert.deepEqual(neighbors(ids, 'z'), { previous: null, next: null, position: 0, total: 3 });
  });
});

describe('focusAfterRemoval: where focus goes when deleting from the panel', () => {
  it('to the one taking its place; if it was the last, to the previous', () => {
    assert.equal(focusAfterRemoval(['a', 'b', 'c'], 'b'), 'c');
    assert.equal(focusAfterRemoval(['a', 'b', 'c'], 'c'), 'b');
  });

  it('it was the only one (or was not there): none', () => {
    assert.equal(focusAfterRemoval(['a'], 'a'), null);
    assert.equal(focusAfterRemoval([], 'a'), null);
  });
});

describe('panelLeaveConfirmation: closing or moving with unsaved changes asks (same rule as leaveGuard)', () => {
  it('without changes it does not ask', () => {
    assert.equal(panelLeaveConfirmation(false, es), null);
  });

  it('with changes, the same text as the navigation guard, in each language', () => {
    assert.equal(panelLeaveConfirmation(true, es), es.t('unsaved.confirm'));
    assert.equal(panelLeaveConfirmation(true, en), en.t('unsaved.confirm'));
  });
});
