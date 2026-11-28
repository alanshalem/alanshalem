import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '../src/i18n/i18n.ts';
import {
  acceptsFileDrag,
  fileKind,
  planTransfer,
  problemMessage,
  remoteImagesMarkdown,
  type FileLike,
  type TransferLike,
} from '../src/editor/pasteFiles.ts';

/*
 * What pasting or dropping into the editor does, decided from the DataTransfer alone: upload images, insert code
 * files as fenced blocks, insert images copied from a web page by their address, or leave it to the native paste.
 */

const file = (name: string, type = '', size = 10): FileLike => ({ name, type, size });

function transfer(files: FileLike[], data: Record<string, string> = {}): TransferLike {
  return {
    files,
    types: [...Object.keys(data), ...(files.length > 0 ? ['Files'] : [])],
    getData: (format) => data[format] ?? '',
  };
}

describe('kind of a pasted or dropped file', () => {
  it('images by MIME type, including formats the browser types and the server names on rejection', () => {
    for (const [name, type] of [
      ['shot.png', 'image/png'], ['photo.jpg', 'image/jpeg'], ['old.bmp', 'image/bmp'], ['scan.tif', 'image/tiff'],
      ['logo.svg', 'image/svg+xml'], ['new.jxl', 'image/jxl'], ['favicon.ico', 'image/x-icon'], ['image.png', 'image/png'],
    ]) {
      assert.equal(fileKind(file(name!, type)), 'image', name);
    }
  });

  it('images by extension when the browser gives no type (HEIC on Windows)', () => {
    assert.equal(fileKind(file('IMG_0001.HEIC', '')), 'image');
    assert.equal(fileKind(file('photo.heif', '')), 'image');
    assert.equal(fileKind(file('photo.avif', '')), 'image');
  });

  it('code by extension, before the MIME type (Windows types .ts as an MPEG video)', () => {
    assert.equal(fileKind(file('script.py', 'text/x-python')), 'code');
    assert.equal(fileKind(file('types.ts', 'video/mp2t')), 'code');
    assert.equal(fileKind(file('Dockerfile', '')), 'code');
    assert.equal(fileKind(file('data.csv', 'text/csv')), 'code');
    assert.equal(fileKind(file('feed.atom', 'application/xml')), 'code');
  });

  it('anything else is not insertable', () => {
    assert.equal(fileKind(file('report.pdf', 'application/pdf')), 'other');
    assert.equal(fileKind(file('archive.zip', 'application/zip')), 'other');
    assert.equal(fileKind(file('clip.mp4', 'video/mp4')), 'other');
    assert.equal(fileKind(file('noextension', '')), 'other');
  });
});

describe('paste and drop plan', () => {
  it('a screenshot (one image/png file, no text) is uploaded', () => {
    const shot = file('image.png', 'image/png');
    assert.deepEqual(planTransfer(transfer([shot]), { source: 'paste' }), { kind: 'files', images: [shot], code: [], other: [] });
  });

  it('an image copied in the browser (the file plus its <img> HTML) uploads the file, not the remote address', () => {
    const copied = file('image.png', 'image/png');
    const plan = planTransfer(transfer([copied], { 'text/html': '<img src="https://example.com/cat.jpg" alt="A cat">' }), { source: 'paste' });
    assert.deepEqual(plan, { kind: 'files', images: [copied], code: [], other: [] });
  });

  it('…also when the browser adds the image address as plain text', () => {
    const copied = file('image.png', 'image/png');
    const data = { 'text/html': '<img src="https://example.com/cat.jpg">', 'text/plain': 'https://example.com/cat.jpg' };
    assert.equal(planTransfer(transfer([copied], data), { source: 'paste' }).kind, 'files');
  });

  it('text copied from Word or Excel (text plus a picture of it) pastes the text, as before', () => {
    const picture = file('image.png', 'image/png');
    const data = { 'text/plain': 'Cell A1\tCell B1', 'text/html': '<table><tr><td>Cell A1</td><td>Cell B1</td></tr></table>' };
    assert.deepEqual(planTransfer(transfer([picture], data), { source: 'paste' }), { kind: 'native' });
  });

  it('dropped files are split by kind, keeping their order', () => {
    const files = [file('a.py', 'text/x-python'), file('b.jpg', 'image/jpeg'), file('c.pdf', 'application/pdf'), file('d.ts', 'video/mp2t'), file('e.HEIC')];
    assert.deepEqual(planTransfer(transfer(files), { source: 'drop' }), {
      kind: 'files',
      images: [files[1], files[4]],
      code: [files[0], files[3]],
      other: [files[2]],
    });
  });

  it('dropping text, or pasting text or rich text, stays with the native paste and the HTML conversion', () => {
    assert.deepEqual(planTransfer(transfer([], { 'text/plain': 'hola' }), { source: 'drop' }), { kind: 'native' });
    assert.deepEqual(planTransfer(transfer([], { 'text/plain': 'hola' }), { source: 'paste' }), { kind: 'native' });
    const rich = { 'text/html': '<p>Some <b>bold</b> and <img src="https://x.com/a.png"></p>', 'text/plain': 'Some bold and' };
    assert.deepEqual(planTransfer(transfer([], rich), { source: 'paste' }), { kind: 'native' });
  });

  it('an image copied from a web page without a file inserts it by its web address, never fetching it', () => {
    const html = '<html><body><!--StartFragment--><img src="https://example.com/a%20b.png?x=1&amp;y=2" alt="A &quot;cat&quot;"><!--EndFragment--></body></html>';
    assert.deepEqual(planTransfer(transfer([], { 'text/html': html }), { source: 'paste' }), {
      kind: 'remoteImages',
      markdown: '![A "cat"](https://example.com/a%20b.png?x=1&y=2)',
    });
  });

  it('the same for an image dragged from another tab without a file', () => {
    const html = '<img src="http://example.com/a.png">';
    assert.deepEqual(planTransfer(transfer([], { 'text/html': html, 'text/uri-list': 'http://example.com/a.png' }), { source: 'drop' }), {
      kind: 'remoteImages',
      markdown: '![](http://example.com/a.png)',
    });
  });

  it('an image without a usable web address (data:, blob:, relative, javascript:) is explained, not inserted', () => {
    for (const src of ['data:image/png;base64,AAAA', 'blob:https://x.com/1', '/local.png', 'javascript:alert(1)', 'file:///C:/a.png']) {
      assert.deepEqual(planTransfer(transfer([], { 'text/html': `<img src="${src}">` }), { source: 'paste' }), { kind: 'imageWithoutAddress' }, src);
    }
  });

  it('Ctrl+Shift+V (plain paste) still uploads files but ignores the HTML', () => {
    const shot = file('image.png', 'image/png');
    assert.equal(planTransfer(transfer([shot]), { source: 'paste', plain: true }).kind, 'files');
    const html = { 'text/html': '<img src="https://example.com/a.png">' };
    assert.deepEqual(planTransfer(transfer([], html), { source: 'paste', plain: true }), { kind: 'native' });
  });
});

describe('remote images from HTML', () => {
  it('only an HTML made of images (and whitespace) counts', () => {
    assert.equal(remoteImagesMarkdown('<p>text <img src="https://x.com/a.png"></p>'), null);
    assert.equal(remoteImagesMarkdown('<p>no images</p>'), null);
    assert.equal(remoteImagesMarkdown(''), null);
  });

  it('several images become one paragraph each; unusable ones are left out', () => {
    assert.deepEqual(
      remoteImagesMarkdown("<img src='https://x.com/1.png' alt=one>&nbsp;<img src=\"data:image/png;base64,AA\"><img alt=\"(two)\" src=\"https://x.com/2 (b).png\">"),
      { markdown: '![one](https://x.com/1.png)\n\n![(two)](<https://x.com/2%20(b).png>)', unusable: 1 },
    );
  });
});

describe('drag over the editor', () => {
  it('accepts a drag that carries files (so the browser never opens them instead)', () => {
    assert.equal(acceptsFileDrag({ types: ['Files'] }), true);
    assert.equal(acceptsFileDrag({ types: ['text/plain', 'text/html'] }), false);
  });
});

describe('messages in the UI language', () => {
  it('Spanish', () => {
    const { t } = i18nFor('es');
    assert.equal(problemMessage({ kind: 'unsupported', name: 'informe.pdf' }, t), 'No se puede insertar informe.pdf: no es una imagen ni un archivo de texto.');
    assert.equal(problemMessage({ kind: 'binary', name: 'tool.sh' }, t), 'tool.sh no es un archivo de texto, así que no se insertó.');
    assert.equal(problemMessage({ kind: 'tooLarge', name: 'big.json' }, t), 'big.json pesa más de 256 KB, así que no se insertó. Pegá solo la parte que necesitás.');
    assert.equal(problemMessage({ kind: 'cannotUpload' }, t), 'Acá no se pueden subir imágenes: insertala con ![descripción](https://…).');
    assert.equal(problemMessage({ kind: 'imageWithoutAddress' }, t), 'Esa imagen no tiene una dirección web que se pueda usar: guardala en tu equipo y arrastrá el archivo acá.');
  });

  it('English', () => {
    const { t } = i18nFor('en');
    assert.equal(problemMessage({ kind: 'unsupported', name: 'report.pdf' }, t), 'Can’t insert report.pdf: it isn’t an image or a text file.');
    assert.equal(problemMessage({ kind: 'binary', name: 'tool.sh' }, t), 'tool.sh isn’t a text file, so it wasn’t inserted.');
    assert.equal(problemMessage({ kind: 'tooLarge', name: 'big.json' }, t), 'big.json is larger than 256 KB, so it wasn’t inserted. Paste only the part you need.');
    assert.equal(problemMessage({ kind: 'cannotUpload' }, t), 'Images can’t be uploaded here: insert it with ![description](https://…).');
    assert.equal(problemMessage({ kind: 'imageWithoutAddress' }, t), 'That image has no usable web address: save it to your device and drag the file here.');
  });
});
