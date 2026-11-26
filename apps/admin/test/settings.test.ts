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
 * Estas reglas son un espejo de las del dominio de la API (L4: SiteSettingsContent, PostContent, WebUrl).
 * Sirven para avisar antes de enviar; la API sigue siendo la autoridad y sus errores se muestran igual.
 */

const es = i18nFor('es');
const en = i18nFor('en');

const form = (overrides: Partial<SettingsForm> = {}): SettingsForm => ({ ...emptySettingsForm(), name: 'Alan', ...overrides });

describe('isImageUrl: ruta /media/... o URL http(s)', () => {
  for (const ok of ['/media/abc.png', '/media/2026/11/x.webp', 'https://ejemplo.com/a.jpg', 'http://ejemplo.com/a', 'HTTPS://EJEMPLO.COM/A.PNG']) {
    it(`acepta ${ok}`, () => assert.equal(isImageUrl(ok), true));
  }
  for (const bad of [
    '',
    '/media/',
    '/media/../secreto.png',
    '/media/%2e%2e/secreto.png',
    '/media/.%2E/secreto.png',
    '/otra/a.png',
    'media/a.png',
    '//otro-sitio.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://',
    'https://ejemplo.com/a b.jpg',
    'https://ejemplo.com/a".jpg',
    'https://ejemplo.com/<a>.jpg',
    'C:\\fotos\\a.jpg',
    `https://ejemplo.com/${'a'.repeat(2048)}`,
  ]) {
    it(`rechaza ${JSON.stringify(bad.slice(0, 40))}`, () => assert.equal(isImageUrl(bad), false));
  }
});

describe('isHttpUrl: solo URLs absolutas http(s) con host', () => {
  it('acepta http y https', () => {
    assert.equal(isHttpUrl('https://github.com/alan'), true);
    assert.equal(isHttpUrl('http://x.com'), true);
  });
  it('rechaza sin esquema, otros esquemas, sin host y rutas /media', () => {
    for (const bad of ['github.com/alan', 'ftp://x.com', 'mailto:a@b.com', 'https://', '/media/a.png', 'https://x.com/a b']) {
      assert.equal(isHttpUrl(bad), false, bad);
    }
  });
});

describe('isEmail: forma mínima algo@dominio.tld', () => {
  it('acepta direcciones comunes', () => {
    assert.equal(isEmail('yo@ejemplo.com'), true);
    assert.equal(isEmail('a@b.c'), true);
  });
  it('rechaza sin dominio, sin tld, con espacios o con dos @', () => {
    for (const bad of ['yo', 'yo@ejemplo', 'yo @ejemplo.com', 'yo@ejemplo .com', 'a@b@c.com', '@ejemplo.com']) {
      assert.equal(isEmail(bad), false, bad);
    }
  });
});

describe('cleanOptional', () => {
  it('recorta y convierte el vacío en null', () => {
    assert.equal(cleanOptional('  hola  '), 'hola');
    assert.equal(cleanOptional('   '), null);
    assert.equal(cleanOptional(''), null);
  });
});

describe('validateSettings', () => {
  it('normaliza: recorta todo y los opcionales vacíos viajan como null', () => {
    const result = validateSettings(
      form({ name: '  Alan  ', tagline: ' Notas ', bio: '  Hola **mundo**  ', email: ' yo@ejemplo.com ', githubUrl: '   ' }),
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
        email: 'yo@ejemplo.com',
        githubUrl: null,
        linkedinUrl: null,
        xUrl: null,
      },
    });
  });

  it('el nombre es obligatorio (vacío o solo espacios)', () => {
    for (const name of ['', '   ']) {
      const result = validateSettings(form({ name }), es);
      assert.equal(result.ok, false);
      assert.deepEqual(!result.ok && result.errors, { name: 'El nombre es obligatorio.' });
    }
  });

  it('límites de largo como la API', () => {
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

  it('justo en el límite pasa', () => {
    const result = validateSettings(form({ name: 'a'.repeat(100), bio: 'a'.repeat(2000) }), es);
    assert.equal(result.ok, true);
  });

  it('junta todos los errores de formato a la vez, con los mensajes de la API', () => {
    const result = validateSettings(
      form({
        email: 'yo@ejemplo',
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

  it('la foto del hero ya no es un ajuste: el formulario no tiene campos heroImage* (L10)', () => {
    assert.deepEqual(Object.keys(emptySettingsForm()).filter((key) => key.startsWith('heroImage')), []);
    const result = validateSettings(form(), es);
    assert.deepEqual(result.ok && Object.keys(result.input).filter((key) => key.startsWith('heroImage')), []);
  });
});

describe('validateSettings: textos en inglés (L4, L6: taglineEn y bioEn, mismos límites que sus pares)', () => {
  it('recorta; vacíos viajan como null (el sitio en inglés usa el texto en español)', () => {
    const result = validateSettings(form({ taglineEn: '  Notes  ', bioEn: '   ' }), es);
    assert.equal(result.ok && result.input.taglineEn, 'Notes');
    assert.equal(result.ok && result.input.bioEn, null);
  });

  it('el nombre es uno solo en los dos idiomas (L12): ni campo ni dato nameEn', () => {
    assert.deepEqual(Object.keys(emptySettingsForm()).filter((key) => key.startsWith('name')), ['name']);
    const result = validateSettings(form({ name: ' Alan ' }), es);
    assert.deepEqual(result.ok && Object.keys(result.input).filter((key) => key.startsWith('name')), ['name']);
    assert.equal(result.ok && result.input.name, 'Alan');
  });

  it('justo en el límite pasa', () => {
    const result = validateSettings(form({ taglineEn: 'a'.repeat(200), bioEn: 'a'.repeat(2000) }), es);
    assert.equal(result.ok, true);
  });

  it('un carácter de más: error en cada campo en inglés', () => {
    const result = validateSettings(form({ taglineEn: 'a'.repeat(201), bioEn: 'a'.repeat(2001) }), es);
    assert.deepEqual(!result.ok && result.errors, {
      taglineEn: 'La frase en inglés no puede superar 200 caracteres.',
      bioEn: 'La bio en inglés no puede superar 2000 caracteres.',
    });
  });
});

describe('validateSettings y validateCover en inglés (L4: también se traducen los mensajes del cliente)', () => {
  it('obligatorio, largo y formato', () => {
    assert.deepEqual(validateSettings(form({ name: ' ' }), en), { ok: false, errors: { name: 'The name is required.' } });
    const result = validateSettings(
      form({ tagline: 'a'.repeat(201), bioEn: 'a'.repeat(2001), email: 'yo@ejemplo', githubUrl: 'github.com/alan' }),
      en,
    );
    assert.deepEqual(!result.ok && result.errors, {
      tagline: 'The tagline can’t be longer than 200 characters.',
      bioEn: 'The English bio can’t be longer than 2000 characters.',
      email: 'The email address isn’t valid.',
      githubUrl: 'The GitHub link must be an http(s) URL.',
    });
  });

  it('portada', () => {
    assert.deepEqual(validateCover('imagenes/p.jpg', '', en), {
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
  it('pasa los null a texto vacío para los inputs', () => {
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

  it('ida y vuelta: lo que viene de la API se vuelve a guardar igual', () => {
    const settings: SiteSettings = {
      name: 'Alan',
      tagline: 'Notas',
      bio: null,
      taglineEn: 'Notes',
      bioEn: null,
      email: 'yo@ejemplo.com',
      githubUrl: null,
      linkedinUrl: 'https://linkedin.com/in/a',
      xUrl: null,
    };
    assert.deepEqual(validateSettings(toSettingsForm(settings), es), { ok: true, input: settings });
  });
});

describe('validateCover', () => {
  it('sin portada: ambos null (un alt sin imagen no significa nada)', () => {
    assert.deepEqual(validateCover('  ', 'texto suelto', es), { ok: true, coverUrl: null, coverAlt: null });
  });

  it('recorta URL y alt; alt vacío = null', () => {
    assert.deepEqual(validateCover(' /media/p.jpg ', '  Un faro  ', es), { ok: true, coverUrl: '/media/p.jpg', coverAlt: 'Un faro' });
    assert.deepEqual(validateCover('https://x.com/p.jpg', ' ', es), { ok: true, coverUrl: 'https://x.com/p.jpg', coverAlt: null });
  });

  it('rechaza URLs que la API rechaza, con su mensaje', () => {
    for (const bad of ['javascript:alert(1)', '//otro.com/p.jpg', 'imagenes/p.jpg']) {
      assert.deepEqual(validateCover(bad, '', es), { ok: false, error: 'La portada debe ser una ruta /media/... o una URL http(s).' });
    }
  });

  it('alt de más de 300 caracteres', () => {
    assert.deepEqual(validateCover('/media/p.jpg', 'a'.repeat(301), es), {
      ok: false,
      error: 'El texto alternativo de la portada no puede superar 300 caracteres.',
    });
  });
});

describe('messageFromProblem: errores ProblemDetails de la API', () => {
  it('prefiere detail (el mensaje del dominio)', () => {
    assert.equal(
      messageFromProblem({ title: 'Datos inválidos', detail: 'El nombre es obligatorio.' }, 'Error 400'),
      'El nombre es obligatorio.',
    );
  });
  it('si no hay detail, usa los errores de validación del binding y si no, el título', () => {
    assert.equal(
      messageFromProblem({ title: 'One or more validation errors occurred.', errors: { name: ['Requerido.'], email: ['Inválido.', 'Muy largo.'] } }, 'x'),
      'Requerido. Inválido. Muy largo.',
    );
    assert.equal(messageFromProblem({ title: 'Conflicto' }, 'Error 409'), 'Conflicto');
  });
  it('si la respuesta no es un ProblemDetails, el fallback', () => {
    assert.equal(messageFromProblem(null, 'Bad Gateway'), 'Bad Gateway');
    assert.equal(messageFromProblem('texto', 'Bad Gateway'), 'Bad Gateway');
    assert.equal(messageFromProblem({ detail: '' }, 'Bad Gateway'), 'Bad Gateway');
  });
});
