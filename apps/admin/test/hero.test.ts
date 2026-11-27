import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HeroImage, MediaAsset } from '../src/api/types.ts';
import {
  discardConfirmation,
  HERO_IMAGE_LIMITS,
  inUploadOrder,
  thumbnailUrl,
  toHeroImageFields,
  validateHeroImage,
  type HeroImageFields,
} from '../src/hero/heroImage.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

const es = i18nFor('es');
const en = i18nFor('en');

/*
 * Rules of a hero photo: `alt` required (≤ 300), `credit` optional (≤ 200).
 * They warn before sending; the API stays the authority and its errors are shown anyway.
 */

const media = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'm1',
  url: '/media/abc/1600.webp',
  width: 3000,
  height: 2000,
  color: '#1a2b3c',
  placeholder: 'data:image/webp;base64,AAAA',
  variants: [],
  createdAt: '2026-11-25T10:00:00Z',
  ...overrides,
});

const heroImage = (id: string, createdAt: string): HeroImage => ({
  id,
  media: media(),
  video: null,
  alt: id,
  credit: null,
  altEn: null,
  createdAt,
});

const fields = (overrides: Partial<HeroImageFields> = {}): HeroImageFields => ({ ...toHeroImageFields(), ...overrides });

describe('validateHeroImage', () => {
  it('trims; an empty credit travels as null', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: '  Nebulosa de Orión  ', credit: '   ' }), es), {
      ok: true,
      input: { alt: 'Nebulosa de Orión', credit: null, altEn: null },
    });
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', credit: ' Foto: Alan ' }), es), {
      ok: true,
      input: { alt: 'Luna', credit: 'Foto: Alan', altEn: null },
    });
  });

  it('the alt text is required (empty or only spaces)', () => {
    for (const alt of ['', '   ']) {
      assert.deepEqual(validateHeroImage(fields({ alt }), es), { ok: false, errors: { alt: 'El texto alternativo es obligatorio.' } });
    }
  });

  it('right at the limit passes', () => {
    const result = validateHeroImage(
      fields({
        alt: 'a'.repeat(HERO_IMAGE_LIMITS.alt),
        credit: 'c'.repeat(HERO_IMAGE_LIMITS.credit),
        altEn: 'a'.repeat(HERO_IMAGE_LIMITS.altEn),
      }),
      es,
    );
    assert.equal(result.ok, true);
  });

  it('one character too many: both errors together', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'a'.repeat(301), credit: 'c'.repeat(201) }), es), {
      ok: false,
      errors: {
        alt: 'El texto alternativo no puede superar 300 caracteres.',
        credit: 'El crédito no puede superar 200 caracteres.',
      },
    });
  });

  it('the API limits; the English alt text, the same as its counterpart; the credit is a single field', () => {
    assert.deepEqual(HERO_IMAGE_LIMITS, { alt: 300, credit: 200, altEn: 300 });
  });

  it('optional English alt text: trimmed, empty = null (the English site uses the Spanish one)', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', altEn: ' Moon ' }), es), {
      ok: true,
      input: { alt: 'Luna', credit: null, altEn: 'Moon' },
    });
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', altEn: '  ' }), es), {
      ok: true,
      input: { alt: 'Luna', credit: null, altEn: null },
    });
  });

  it('English alt text: one character too many, with its own message', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', altEn: 'a'.repeat(301) }), es), {
      ok: false,
      errors: { altEn: 'El texto alternativo en inglés no puede superar 300 caracteres.' },
    });
  });
});

describe('validateHeroImage in English', () => {
  it('required and length, with each field message', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: '' }), en), { ok: false, errors: { alt: 'The alt text is required.' } });
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', credit: 'c'.repeat(201), altEn: 'a'.repeat(301) }), en), {
      ok: false,
      errors: {
        credit: 'The credit can’t be longer than 200 characters.',
        altEn: 'The English alt text can’t be longer than 300 characters.',
      },
    });
  });
});

describe('toHeroImageFields: the saved values as input text', () => {
  it('without a saved item: all empty', () => {
    assert.deepEqual(toHeroImageFields(), { alt: '', credit: '', altEn: '' });
  });
  it('nulls become empty; the round trip is identical', () => {
    const saved = { alt: 'Luna', credit: null, altEn: 'Moon' };
    assert.deepEqual(toHeroImageFields(saved), { alt: 'Luna', credit: '', altEn: 'Moon' });
    assert.deepEqual(validateHeroImage(toHeroImageFields(saved), es), { ok: true, input: saved });
  });
});

describe('thumbnailUrl: the smallest WebP variant', () => {
  it('picks the narrowest WebP and ignores AVIF', () => {
    const asset = media({
      variants: [
        { format: 'avif', width: 640, url: '/media/abc/640.avif' },
        { format: 'webp', width: 1600, url: '/media/abc/1600.webp' },
        { format: 'webp', width: 640, url: '/media/abc/640.webp' },
        { format: 'webp', width: 1024, url: '/media/abc/1024.webp' },
      ],
    });
    assert.equal(thumbnailUrl(asset), '/media/abc/640.webp');
  });

  it('without WebP variants it uses the asset main URL', () => {
    assert.equal(thumbnailUrl(media({ variants: [{ format: 'avif', width: 640, url: '/media/abc/640.avif' }] })), '/media/abc/1600.webp');
    assert.equal(thumbnailUrl(media()), '/media/abc/1600.webp');
  });
});

describe('inUploadOrder', () => {
  it('sorts by ascending upload date without mutating the list', () => {
    const list = [heroImage('c', '2026-11-25T12:00:00Z'), heroImage('a', '2026-11-25T10:00:00Z'), heroImage('b', '2026-11-25T11:00:00Z')];
    assert.deepEqual(
      inUploadOrder(list).map((image) => image.id),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(
      list.map((image) => image.id),
      ['c', 'a', 'b'],
    );
  });
});

describe('discardConfirmation: Descartar asks for confirmation only if finished work would be lost', () => {
  it('a video being processed or an already uploaded file: asks, with the file name', () => {
    assert.equal(
      discardConfirmation({ status: 'processing', fileName: 'mar.mp4' }, es),
      '¿Descartar “mar.mp4”? El video se está procesando: se pierde ese trabajo.',
    );
    assert.equal(
      discardConfirmation({ status: 'uploaded', fileName: 'luna.jpg' }, es),
      '¿Descartar “luna.jpg”? Ya se subió: para usarlo hay que volver a subirlo.',
    );
    assert.equal(
      discardConfirmation({ status: 'processing', fileName: 'sea.mp4' }, en),
      'Discard “sea.mp4”? The video is being processed: that work will be lost.',
    );
    assert.equal(
      discardConfirmation({ status: 'uploaded', fileName: 'moon.jpg' }, en),
      'Discard “moon.jpg”? It was already uploaded: to use it you will have to upload it again.',
    );
  });

  it('nothing to lose (in the editor, queued, uploading or failed): discards without asking', () => {
    for (const status of ['editing', 'queued', 'uploading', 'failed'] as const) {
      assert.equal(discardConfirmation({ status, fileName: 'x.jpg' }, es), null, status);
    }
  });
});
