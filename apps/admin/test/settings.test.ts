import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageFromProblem } from '../src/api/problem.ts';
import type { SiteSettings } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import {
  cleanOptional,
  emptySettingsForm,
  isEmail,
  isHttpUrl,
  isImageUrl,
  toSettingsForm,
  validateCover,
  validateSettings,
  type SettingsForm,
} from '../src/settings/validate.ts';

/*
 * These rules mirror the API domain ones (SiteSettingsContent, PostContent, WebUrl).
 * They warn before sending; the API stays the authority and its errors are shown anyway.
 */

const es = i18nFor('es');
const en = i18nFor('en');

const form = (overrides: Partial<SettingsForm> = {}): SettingsForm => ({ ...emptySettingsForm(), name: 'Alan', ...overrides });

describe('isImageUrl: /media/... path or http(s) URL', () => {
  for (const ok of ['/media/abc.png', '/media/2026/11/x.webp', 'https://example.com/a.jpg', 'http://example.com/a', 'HTTPS://EXAMPLE.COM/A.PNG']) {
    it(`accepts ${ok}`, () => assert.equal(isImageUrl(ok), true));
  }
  for (const bad of [
    '',
    '/media/',
    '/media/../secret.png',
    '/media/%2e%2e/secret.png',
    '/media/.%2E/secret.png',
    '/other/a.png',
    'media/a.png',
    '//other-site.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://',
    'https://example.com/a b.jpg',
    'https://example.com/a".jpg',
    'https://example.com/<a>.jpg',
    'C:\\photos\\a.jpg',
    `https://example.com/${'a'.repeat(2048)}`,
  ]) {
    it(`rejects ${JSON.stringify(bad.slice(0, 40))}`, () => assert.equal(isImageUrl(bad), false));
  }
});

describe('isHttpUrl: only absolute http(s) URLs with a host', () => {
  it('accepts http and https', () => {
    assert.equal(isHttpUrl('https://github.com/alan'), true);
    assert.equal(isHttpUrl('http://x.com'), true);
  });
  it('rejects no scheme, other schemes, no host and /media paths', () => {
    for (const bad of ['github.com/alan', 'ftp://x.com', 'mailto:a@b.com', 'https://', '/media/a.png', 'https://x.com/a b']) {
      assert.equal(isHttpUrl(bad), false, bad);
    }
  });
});

describe('isEmail: minimal something@domain.tld shape', () => {
  it('accepts common addresses', () => {
    assert.equal(isEmail('me@example.com'), true);
    assert.equal(isEmail('a@b.c'), true);
  });
  it('rejects no domain, no tld, with spaces or with two @', () => {
    for (const bad of ['me', 'me@example', 'me @example.com', 'me@example .com', 'a@b@c.com', '@example.com']) {
      assert.equal(isEmail(bad), false, bad);
    }
  });
});

describe('cleanOptional', () => {
  it('trims and turns empty into null', () => {
    assert.equal(cleanOptional('  hola  '), 'hola');
    assert.equal(cleanOptional('   '), null);
    assert.equal(cleanOptional(''), null);
  });
});

describe('validateSettings', () => {
  it('normalizes: trims everything and empty optionals travel as null', () => {
    const result = validateSettings(
      form({ name: '  Alan  ', tagline: ' Notas ', bio: '  Hola **mundo**  ', email: ' me@example.com ', githubUrl: '   ' }),
      es,
    );
    assert.deepEqual(result, {
      ok: true,
      input: {
        name: 'Alan',
        tagline: 'Notas',
        bio: 'Hola **mundo**',
        taglineEn: null,
        bioEn: null,
        email: 'me@example.com',
        githubUrl: null,
        linkedinUrl: null,
        xUrl: null,
      },
    });
  });

  it('the name is required (empty or only spaces)', () => {
    for (const name of ['', '   ']) {
      const result = validateSettings(form({ name }), es);
      assert.equal(result.ok, false);
      assert.deepEqual(!result.ok && result.errors, { name: 'El nombre es obligatorio.' });
    }
  });

  it('length limits like the API', () => {
    const result = validateSettings(
      form({ name: 'a'.repeat(101), tagline: 'a'.repeat(201), bio: 'a'.repeat(2001) }),
      es,
    );
    assert.deepEqual(!result.ok && result.errors, {
      name: 'El nombre no puede superar 100 caracteres.',
      tagline: 'La frase no puede superar 200 caracteres.',
      bio: 'La bio no puede superar 2000 caracteres.',
    });
  });

  it('right at the limit passes', () => {
    const result = validateSettings(form({ name: 'a'.repeat(100), bio: 'a'.repeat(2000) }), es);
    assert.equal(result.ok, true);
  });

  it('collects every format error at once, with the API messages', () => {
    const result = validateSettings(
      form({
        email: 'me@example',
        githubUrl: 'github.com/alan',
        linkedinUrl: 'javascript:alert(1)',
        xUrl: '/media/x.png',
      }),
      es,
    );
    assert.deepEqual(!result.ok && result.errors, {
      email: 'El email no tiene un formato válido.',
      githubUrl: 'El enlace de GitHub debe ser una URL http(s).',
      linkedinUrl: 'El enlace de LinkedIn debe ser una URL http(s).',
      xUrl: 'El enlace de X debe ser una URL http(s).',
    });
  });

  it('the hero photo is no longer a setting: the form has no heroImage* fields', () => {
    assert.deepEqual(Object.keys(emptySettingsForm()).filter((key) => key.startsWith('heroImage')), []);
    const result = validateSettings(form(), es);
    assert.deepEqual(result.ok && Object.keys(result.input).filter((key) => key.startsWith('heroImage')), []);
  });
});

describe('validateSettings: English texts (taglineEn and bioEn, same limits as their counterparts)', () => {
  it('trims; empty ones travel as null (the English site uses the Spanish text)', () => {
    const result = validateSettings(form({ taglineEn: '  Notes  ', bioEn: '   ' }), es);
    assert.equal(result.ok && result.input.taglineEn, 'Notes');
    assert.equal(result.ok && result.input.bioEn, null);
  });

  it('the name is a single field for both languages: no nameEn field or value', () => {
    assert.deepEqual(Object.keys(emptySettingsForm()).filter((key) => key.startsWith('name')), ['name']);
    const result = validateSettings(form({ name: ' Alan ' }), es);
    assert.deepEqual(result.ok && Object.keys(result.input).filter((key) => key.startsWith('name')), ['name']);
    assert.equal(result.ok && result.input.name, 'Alan');
  });

  it('right at the limit passes', () => {
    const result = validateSettings(form({ taglineEn: 'a'.repeat(200), bioEn: 'a'.repeat(2000) }), es);
    assert.equal(result.ok, true);
  });

  it('one character too many: an error on each English field', () => {
    const result = validateSettings(form({ taglineEn: 'a'.repeat(201), bioEn: 'a'.repeat(2001) }), es);
    assert.deepEqual(!result.ok && result.errors, {
      taglineEn: 'La frase en inglés no puede superar 200 caracteres.',
      bioEn: 'La bio en inglés no puede superar 2000 caracteres.',
    });
  });
});

describe('validateSettings and validateCover in English (the client messages are translated too)', () => {
  it('required, length and format', () => {
    assert.deepEqual(validateSettings(form({ name: ' ' }), en), { ok: false, errors: { name: 'The name is required.' } });
    const result = validateSettings(
      form({ tagline: 'a'.repeat(201), bioEn: 'a'.repeat(2001), email: 'me@example', githubUrl: 'github.com/alan' }),
      en,
    );
    assert.deepEqual(!result.ok && result.errors, {
      tagline: 'The tagline can’t be longer than 200 characters.',
      bioEn: 'The English bio can’t be longer than 2000 characters.',
      email: 'The email address isn’t valid.',
      githubUrl: 'The GitHub link must be an http(s) URL.',
    });
  });

  it('cover', () => {
    assert.deepEqual(validateCover('images/p.jpg', '', en), {
      ok: false,
      error: 'The cover must be a /media/... path or an http(s) URL.',
    });
    assert.deepEqual(validateCover('/media/p.jpg', 'a'.repeat(301), en), {
      ok: false,
      error: 'The cover alt text can’t be longer than 300 characters.',
    });
  });
});

describe('toSettingsForm', () => {
  it('turns nulls into empty text for the inputs', () => {
    const settings: SiteSettings = {
      name: 'Mi blog',
      tagline: null,
      bio: 'Bio',
      taglineEn: null,
      bioEn: 'Bio in English',
      email: null,
      githubUrl: 'https://github.com/a',
      linkedinUrl: null,
      xUrl: null,
    };
    assert.deepEqual(toSettingsForm(settings), {
      ...emptySettingsForm(),
      name: 'Mi blog',
      bio: 'Bio',
      bioEn: 'Bio in English',
      githubUrl: 'https://github.com/a',
    });
  });

  it('round trip: what comes from the API is saved back unchanged', () => {
    const settings: SiteSettings = {
      name: 'Alan',
      tagline: 'Notas',
      bio: null,
      taglineEn: 'Notes',
      bioEn: null,
      email: 'me@example.com',
      githubUrl: null,
      linkedinUrl: 'https://linkedin.com/in/a',
      xUrl: null,
    };
    assert.deepEqual(validateSettings(toSettingsForm(settings), es), { ok: true, input: settings });
  });
});

describe('validateCover', () => {
  it('no cover: both null (an alt without an image means nothing)', () => {
    assert.deepEqual(validateCover('  ', 'stray text', es), { ok: true, coverUrl: null, coverAlt: null });
  });

  it('trims URL and alt; empty alt = null', () => {
    assert.deepEqual(validateCover(' /media/p.jpg ', '  Un faro  ', es), { ok: true, coverUrl: '/media/p.jpg', coverAlt: 'Un faro' });
    assert.deepEqual(validateCover('https://x.com/p.jpg', ' ', es), { ok: true, coverUrl: 'https://x.com/p.jpg', coverAlt: null });
  });

  it('rejects the URLs the API rejects, with its message', () => {
    for (const bad of ['javascript:alert(1)', '//other.com/p.jpg', 'images/p.jpg']) {
      assert.deepEqual(validateCover(bad, '', es), { ok: false, error: 'La portada debe ser una ruta /media/... o una URL http(s).' });
    }
  });

  it('alt longer than 300 characters', () => {
    assert.deepEqual(validateCover('/media/p.jpg', 'a'.repeat(301), es), {
      ok: false,
      error: 'El texto alternativo de la portada no puede superar 300 caracteres.',
    });
  });
});

describe('messageFromProblem: API ProblemDetails errors', () => {
  it('prefers detail (the domain message)', () => {
    assert.equal(
      messageFromProblem({ title: 'Datos inválidos', detail: 'El nombre es obligatorio.' }, 'Error 400'),
      'El nombre es obligatorio.',
    );
  });
  it('without detail, it uses the binding validation errors and otherwise the title', () => {
    assert.equal(
      messageFromProblem({ title: 'One or more validation errors occurred.', errors: { name: ['Requerido.'], email: ['Inválido.', 'Muy largo.'] } }, 'x'),
      'Requerido. Inválido. Muy largo.',
    );
    assert.equal(messageFromProblem({ title: 'Conflicto' }, 'Error 409'), 'Conflicto');
  });
  it('if the response is not a ProblemDetails, the fallback', () => {
    assert.equal(messageFromProblem(null, 'Bad Gateway'), 'Bad Gateway');
    assert.equal(messageFromProblem('text', 'Bad Gateway'), 'Bad Gateway');
    assert.equal(messageFromProblem({ detail: '' }, 'Bad Gateway'), 'Bad Gateway');
  });
});
