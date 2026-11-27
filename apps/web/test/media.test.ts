import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexMedia, srcset } from '../src/lib/media.ts';
import { mediaAsset } from './fixtures.ts';

describe('indexMedia: any URL of an asset leads to its MediaAsset', () => {
  const a = mediaAsset('aaa');
  const b = mediaAsset('bbb');
  const media = indexMedia([a, b]);

  it('finds the asset by its main `url`', () => {
    assert.equal(media.get('/media/aaa/1600.webp'), a);
  });

  it('finds the asset by the URL of any variant, AVIF or WebP', () => {
    assert.equal(media.get('/media/aaa/640.avif'), a);
    assert.equal(media.get('/media/bbb/1024.webp'), b);
  });

  it('a URL of no asset is not in the index', () => {
    assert.equal(media.get('/media/zzz/640.webp'), undefined);
    assert.equal(media.get('https://cdn.example.com/a.jpg'), undefined);
  });

  it('an empty list gives an empty index', () => {
    assert.equal(indexMedia([]).size, 0);
  });
});

describe('srcset: one "url width" entry per variant of the format, smallest to largest', () => {
  it('lists only the requested format, sorted by width', () => {
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

  it('without variants of the format it returns an empty string', () => {
    assert.equal(srcset(mediaAsset('aaa', { variants: [] }), 'avif'), '');
  });
});
