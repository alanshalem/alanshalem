import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HeroImage, MediaAsset } from '../src/api/types.ts';
import { HERO_IMAGE_LIMITS, inUploadOrder, thumbnailUrl, validateHeroImage } from '../src/hero/heroImage.ts';

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

const heroImage = (id: string, createdAt: string): HeroImage => ({ id, media: media(), video: null, alt: id, credit: null, createdAt });

describe('validateHeroImage', () => {
  it('recorta; el crédito vacío viaja como null', () => {
    assert.deepEqual(validateHeroImage('  Nebulosa de Orión  ', '   '), {
      ok: true,
      input: { alt: 'Nebulosa de Orión', credit: null },
    });
    assert.deepEqual(validateHeroImage('Luna', ' Foto: Alan '), { ok: true, input: { alt: 'Luna', credit: 'Foto: Alan' } });
  });

  it('el texto alternativo es obligatorio (vacío o solo espacios)', () => {
    for (const alt of ['', '   ']) {
      assert.deepEqual(validateHeroImage(alt, ''), { ok: false, errors: { alt: 'El texto alternativo es obligatorio.' } });
    }
  });

  it('justo en el límite pasa', () => {
    const result = validateHeroImage('a'.repeat(HERO_IMAGE_LIMITS.alt), 'c'.repeat(HERO_IMAGE_LIMITS.credit));
    assert.equal(result.ok, true);
  });

  it('un carácter de más: junta los dos errores a la vez', () => {
    assert.deepEqual(validateHeroImage('a'.repeat(301), 'c'.repeat(201)), {
      ok: false,
      errors: {
        alt: 'El texto alternativo no puede superar 300 caracteres.',
        credit: 'El crédito no puede superar 200 caracteres.',
      },
    });
  });

  it('los límites son los de L10', () => {
    assert.deepEqual(HERO_IMAGE_LIMITS, { alt: 300, credit: 200 });
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
