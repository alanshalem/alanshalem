import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexMedia, srcset } from '../src/lib/media.ts';
import { mediaAsset } from './fixtures.ts';

describe('indexMedia: cualquier URL de un asset lleva a su MediaAsset (S6)', () => {
  const a = mediaAsset('aaa');
  const b = mediaAsset('bbb');
  const media = indexMedia([a, b]);

  it('encuentra el asset por su `url` principal', () => {
    assert.equal(media.get('/media/aaa/1600.webp'), a);
  });

  it('encuentra el asset por la URL de cualquier variante, AVIF o WebP', () => {
    assert.equal(media.get('/media/aaa/640.avif'), a);
    assert.equal(media.get('/media/bbb/1024.webp'), b);
  });

  it('una URL que no es de ningún asset no está en el índice', () => {
    assert.equal(media.get('/media/zzz/640.webp'), undefined);
    assert.equal(media.get('https://cdn.example.com/a.jpg'), undefined);
  });

  it('una lista vacía da un índice vacío', () => {
    assert.equal(indexMedia([]).size, 0);
  });
});

describe('srcset: una entrada "url ancho" por variante del formato, de menor a mayor', () => {
  it('lista solo el formato pedido, ordenado por ancho', () => {
    const asset = mediaAsset('aaa', {
      variants: [
        { format: 'webp', width: 1600, url: '/media/aaa/1600.webp' },
        { format: 'avif', width: 640, url: '/media/aaa/640.avif' },
        { format: 'webp', width: 640, url: '/media/aaa/640.webp' },
      ],
    });
    assert.equal(srcset(asset, 'webp'), '/media/aaa/640.webp 640w, /media/aaa/1600.webp 1600w');
    assert.equal(srcset(asset, 'avif'), '/media/aaa/640.avif 640w');
  });

  it('sin variantes del formato devuelve cadena vacía', () => {
    assert.equal(srcset(mediaAsset('aaa', { variants: [] }), 'avif'), '');
  });
});
