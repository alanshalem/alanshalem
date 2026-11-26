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
 * Grilla de miniaturas + panel lateral del hero (plataforma-calidad U7, L15): con 50 ítems la lista de fichas grandes
 * se volvía enorme. Reglas puras: filtrar, contar, detectar el texto en inglés que falta y moverse entre ítems.
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

// 1 foto con inglés, 2 video sin inglés, 3 foto sin inglés (vacío), 4 video con inglés, 5 foto con solo espacios.
const images: HeroImage[] = [
  item('a'),
  item('b', { video, altEn: null }),
  item('c', { altEn: '' }),
  item('d', { video }),
  item('e', { altEn: '   ' }),
];

describe('missingEnglish: falta el texto alternativo en inglés', () => {
  it('null, vacío o solo espacios = falta (el sitio en inglés usa el de español)', () => {
    assert.equal(missingEnglish({ altEn: null }), true);
    assert.equal(missingEnglish({ altEn: '' }), true);
    assert.equal(missingEnglish({ altEn: '  ' }), true);
  });

  it('con texto no falta', () => {
    assert.equal(missingEnglish({ altEn: 'A lake' }), false);
  });
});

describe('heroTiles: filtrar sin perder el número de orden', () => {
  it('los filtros, en el orden del control segmentado', () => {
    assert.deepEqual(HERO_FILTERS, ['all', 'photo', 'video', 'missingEn']);
  });

  it('Todas: todos, numerados desde 1 en el orden de subida', () => {
    assert.deepEqual(
      heroTiles(images, 'all').map(({ image, number }) => [image.id, number]),
      [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]],
    );
  });

  it('Fotos, Videos y Sin inglés conservan el número de la lista completa', () => {
    assert.deepEqual(heroTiles(images, 'photo').map(({ image, number }) => [image.id, number]), [['a', 1], ['c', 3], ['e', 5]]);
    assert.deepEqual(heroTiles(images, 'video').map(({ image, number }) => [image.id, number]), [['b', 2], ['d', 4]]);
    assert.deepEqual(heroTiles(images, 'missingEn').map(({ image, number }) => [image.id, number]), [['b', 2], ['c', 3], ['e', 5]]);
  });

  it('cada miniatura sabe si es video y si le falta el inglés (las marcas)', () => {
    assert.deepEqual(
      heroTiles(images, 'all').map(({ kind, missingEn }) => [kind, missingEn]),
      [['photo', false], ['video', true], ['photo', true], ['video', false], ['photo', true]],
    );
  });

  it('sin coincidencias: lista vacía (la vista muestra el aviso corto)', () => {
    assert.deepEqual(heroTiles([item('a')], 'video'), []);
    assert.deepEqual(heroTiles([], 'all'), []);
  });
});

describe('countHeroItems + heroCountText: "12 fotos · 3 videos"', () => {
  it('cuenta cada filtro', () => {
    assert.deepEqual(countHeroItems(images), { all: 5, photo: 3, video: 2, missingEn: 3 });
    assert.deepEqual(countHeroItems([]), { all: 0, photo: 0, video: 0, missingEn: 0 });
  });

  it('plural en español y en inglés', () => {
    assert.equal(heroCountText(countHeroItems(images), es), '3 fotos · 2 videos');
    assert.equal(heroCountText(countHeroItems(images), en), '3 photos · 2 videos');
    assert.equal(heroCountText({ all: 2, photo: 1, video: 1, missingEn: 0 }, es), '1 foto · 1 video');
    assert.equal(heroCountText({ all: 2, photo: 1, video: 1, missingEn: 0 }, en), '1 photo · 1 video');
  });

  it('un tipo que no hay no se nombra; sin nada, vacío', () => {
    assert.equal(heroCountText({ all: 12, photo: 12, video: 0, missingEn: 0 }, es), '12 fotos');
    assert.equal(heroCountText({ all: 3, photo: 0, video: 3, missingEn: 0 }, en), '3 videos');
    assert.equal(heroCountText(countHeroItems([]), es), '');
  });
});

describe('tileLabel: nombre accesible de la miniatura (WCAG 2.5.3 y 1.1.1)', () => {
  const [a, b, c] = heroTiles(images, 'all');

  it('empieza con el número visible, sigue con el texto alternativo y nombra las marcas visibles', () => {
    assert.equal(tileLabel(a!, es), '1. Alt a');
    assert.equal(tileLabel(b!, es), '2. Alt b · Video · Sin inglés');
    assert.equal(tileLabel(c!, es), '3. Alt c · Sin inglés');
    assert.equal(tileLabel(b!, en), '2. Alt b · Video · No English');
  });

  it('las marcas usan los mismos textos que se ven (y que el filtro)', () => {
    for (const i18n of [es, en]) {
      const label = tileLabel(b!, i18n);
      assert.ok(label.startsWith('2. '), label);
      assert.ok(label.includes(i18n.t('hero.badge.video')), label);
      assert.ok(label.includes(i18n.t('hero.filter.missingEn')), label);
    }
  });
});

describe('neighbors: anterior y siguiente dentro del panel', () => {
  const ids = ['a', 'b', 'c'];

  it('en el medio hay los dos; la posición cuenta desde 1', () => {
    assert.deepEqual(neighbors(ids, 'b'), { previous: 'a', next: 'c', position: 2, total: 3 });
  });

  it('en los extremos no da la vuelta', () => {
    assert.deepEqual(neighbors(ids, 'a'), { previous: null, next: 'b', position: 1, total: 3 });
    assert.deepEqual(neighbors(ids, 'c'), { previous: 'b', next: null, position: 3, total: 3 });
  });

  it('uno solo, o un id que ya no está: sin vecinos', () => {
    assert.deepEqual(neighbors(['a'], 'a'), { previous: null, next: null, position: 1, total: 1 });
    assert.deepEqual(neighbors(ids, 'z'), { previous: null, next: null, position: 0, total: 3 });
  });
});

describe('focusAfterRemoval: adónde va el foco al eliminar desde el panel', () => {
  it('al que ocupa su lugar; si era el último, al anterior', () => {
    assert.equal(focusAfterRemoval(['a', 'b', 'c'], 'b'), 'c');
    assert.equal(focusAfterRemoval(['a', 'b', 'c'], 'c'), 'b');
  });

  it('era el único (o no estaba): ninguno', () => {
    assert.equal(focusAfterRemoval(['a'], 'a'), null);
    assert.equal(focusAfterRemoval([], 'a'), null);
  });
});

describe('panelLeaveConfirmation: cerrar o moverse con cambios sin guardar pregunta (misma regla que leaveGuard)', () => {
  it('sin cambios no pregunta', () => {
    assert.equal(panelLeaveConfirmation(false, es), null);
  });

  it('con cambios, el mismo texto del guardia de navegación, en cada idioma', () => {
    assert.equal(panelLeaveConfirmation(true, es), es.t('unsaved.confirm'));
    assert.equal(panelLeaveConfirmation(true, en), en.t('unsaved.confirm'));
  });
});
