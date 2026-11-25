import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HeroImage, MediaAsset } from '../src/api/types.ts';
import {
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
 * Reglas de una foto del hero (L10): `alt` obligatorio (≤ 300), `credit` opcional (≤ 200).
 * Avisan antes de enviar; la API sigue siendo la autoridad y sus errores se muestran igual.
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
  creditEn: null,
  createdAt,
});

const fields = (overrides: Partial<HeroImageFields> = {}): HeroImageFields => ({ ...toHeroImageFields(), ...overrides });

describe('validateHeroImage', () => {
  it('recorta; el crédito vacío viaja como null', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: '  Nebulosa de Orión  ', credit: '   ' }), es), {
      ok: true,
      input: { alt: 'Nebulosa de Orión', credit: null, altEn: null, creditEn: null },
    });
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', credit: ' Foto: Alan ' }), es), {
      ok: true,
      input: { alt: 'Luna', credit: 'Foto: Alan', altEn: null, creditEn: null },
    });
  });

  it('el texto alternativo es obligatorio (vacío o solo espacios)', () => {
    for (const alt of ['', '   ']) {
      assert.deepEqual(validateHeroImage(fields({ alt }), es), { ok: false, errors: { alt: 'El texto alternativo es obligatorio.' } });
    }
  });

  it('justo en el límite pasa', () => {
    const result = validateHeroImage(
      fields({
        alt: 'a'.repeat(HERO_IMAGE_LIMITS.alt),
        credit: 'c'.repeat(HERO_IMAGE_LIMITS.credit),
        altEn: 'a'.repeat(HERO_IMAGE_LIMITS.altEn),
        creditEn: 'c'.repeat(HERO_IMAGE_LIMITS.creditEn),
      }),
      es,
    );
    assert.equal(result.ok, true);
  });

  it('un carácter de más: junta los dos errores a la vez', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'a'.repeat(301), credit: 'c'.repeat(201) }), es), {
      ok: false,
      errors: {
        alt: 'El texto alternativo no puede superar 300 caracteres.',
        credit: 'El crédito no puede superar 200 caracteres.',
      },
    });
  });

  it('los límites son los de L10; los textos en inglés, los mismos que su par (L4)', () => {
    assert.deepEqual(HERO_IMAGE_LIMITS, { alt: 300, credit: 200, altEn: 300, creditEn: 200 });
  });

  it('textos en inglés opcionales: recortados, vacíos = null (el sitio en inglés usa los de español)', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', altEn: ' Moon ', creditEn: '  ' }), es), {
      ok: true,
      input: { alt: 'Luna', credit: null, altEn: 'Moon', creditEn: null },
    });
  });

  it('textos en inglés: un carácter de más, con su propio mensaje', () => {
    assert.deepEqual(validateHeroImage(fields({ alt: 'Luna', altEn: 'a'.repeat(301), creditEn: 'c'.repeat(201) }), es), {
      ok: false,
      errors: {
        altEn: 'El texto alternativo en inglés no puede superar 300 caracteres.',
        creditEn: 'El crédito en inglés no puede superar 200 caracteres.',
      },
    });
  });
});

describe('validateHeroImage en inglés', () => {
  it('obligatorio y largo, con el mensaje de cada campo', () => {
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

describe('toHeroImageFields: lo guardado como texto de los inputs', () => {
  it('sin ítem guardado: todo vacío', () => {
    assert.deepEqual(toHeroImageFields(), { alt: '', credit: '', altEn: '', creditEn: '' });
  });
  it('los null pasan a vacío; ida y vuelta igual', () => {
    const saved = { alt: 'Luna', credit: null, altEn: 'Moon', creditEn: null };
    assert.deepEqual(toHeroImageFields(saved), { alt: 'Luna', credit: '', altEn: 'Moon', creditEn: '' });
    assert.deepEqual(validateHeroImage(toHeroImageFields(saved), es), { ok: true, input: saved });
  });
});

describe('thumbnailUrl: la variante WebP más chica', () => {
  it('elige el WebP de menor ancho e ignora AVIF', () => {
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

  it('sin variantes WebP usa la URL principal del asset', () => {
    assert.equal(thumbnailUrl(media({ variants: [{ format: 'avif', width: 640, url: '/media/abc/640.avif' }] })), '/media/abc/1600.webp');
    assert.equal(thumbnailUrl(media()), '/media/abc/1600.webp');
  });
});

describe('inUploadOrder', () => {
  it('ordena por fecha de subida ascendente sin mutar la lista', () => {
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
