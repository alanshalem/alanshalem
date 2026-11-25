import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import { i18nFor, loadUiLang, saveUiLang, UI_LANG_STORAGE_KEY } from '../src/i18n/i18n.ts';

/* Interfaz del admin en es/en (S6, L4): un diccionario por idioma con las mismas claves, elegido por el usuario. */

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe('diccionarios: paridad de claves', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  });

  it('ningún texto vacío', () => {
    for (const [lang, dictionary] of Object.entries({ es, en })) {
      for (const [key, text] of Object.entries(dictionary)) assert.notEqual(text.trim(), '', `${lang}: ${key}`);
    }
  });

  it('cada traducción usa los mismos {parámetros} que el original', () => {
    for (const [key, text] of Object.entries(es)) {
      assert.deepEqual(placeholders(en[key as keyof typeof es]), placeholders(text), key);
    }
  });
});

describe('t: interpolación', () => {
  it('reemplaza {parámetros} por su valor', () => {
    assert.equal(i18nFor('es').t('post.confirmDelete', { title: 'Hola' }), '¿Eliminar "Hola"? No se puede deshacer.');
    assert.equal(i18nFor('en').t('post.confirmDelete', { title: 'Hello' }), 'Delete "Hello"? This can’t be undone.');
  });

  it('los números salen con el formato del idioma: a lo sumo una décima, sin separador de miles', () => {
    assert.equal(i18nFor('es').t('video.tooShort', { seconds: 0.6, min: 1 }), 'Dura 0,6 s: el mínimo es 1 s.');
    assert.equal(i18nFor('en').t('video.tooShort', { seconds: 0.6, min: 1 }), 'It’s only 0.6 s long: the minimum is 1 s.');
    assert.equal(
      i18nFor('es').t('validation.tooLong', { subject: 'La URL', max: 2048 }),
      'La URL no puede superar 2048 caracteres.',
    );
  });

  it('un parámetro que falta queda a la vista (un error visible, no un texto vacío)', () => {
    assert.equal(i18nFor('es').t('post.confirmDelete'), '¿Eliminar "{title}"? No se puede deshacer.');
  });
});

describe('plural: uno u otros', () => {
  it('1 en singular; 0 y el resto en plural, en los dos idiomas', () => {
    const spanish = i18nFor('es');
    const english = i18nFor('en');
    assert.deepEqual([0, 1, 2].map((count) => spanish.plural(count, 'posts.published')), ['0 publicados', '1 publicado', '2 publicados']);
    assert.deepEqual([1, 3].map((count) => english.plural(count, 'posts.count')), ['1 post', '3 posts']);
  });
});

describe('formatDate y formatNumber según el idioma (es-AR / en-US)', () => {
  it('fecha media', () => {
    assert.equal(i18nFor('es').formatDate('2026-11-25T12:00:00Z'), '25 nov 2026');
    assert.equal(i18nFor('en').formatDate('2026-11-25T12:00:00Z'), 'Nov 25, 2026');
  });

  it('decimales con coma o punto; con una décima fija si se pide', () => {
    assert.equal(i18nFor('es').formatNumber(2.5), '2,5');
    assert.equal(i18nFor('en').formatNumber(2.5), '2.5');
    assert.equal(i18nFor('es').formatNumber(2, 1), '2,0');
    assert.equal(i18nFor('en').formatNumber(2, 1), '2.0');
  });

  it('i18nFor devuelve siempre la misma instancia por idioma', () => {
    assert.equal(i18nFor('en'), i18nFor('en'));
    assert.equal(i18nFor('es').lang, 'es');
  });
});

describe('idioma inicial: lo guardado; si no, el del navegador (en* → en; el resto → es)', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  };

  it('sin nada guardado decide el navegador', () => {
    for (const language of ['en', 'en-US', 'en-GB', 'EN-us']) assert.equal(loadUiLang(storage(), language), 'en', language);
    for (const language of ['es', 'es-AR', 'pt-BR', 'fr', '']) assert.equal(loadUiLang(storage(), language), 'es', language);
  });

  it('lo guardado gana al navegador', () => {
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'es' }), 'en-US'), 'es');
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'en' }), 'es-AR'), 'en');
  });

  it('un valor guardado desconocido se ignora', () => {
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'fr' }), 'en-US'), 'en');
  });

  it('saveUiLang persiste la elección: la próxima carga la respeta', () => {
    const store = storage();
    saveUiLang(store, 'en');
    assert.equal(loadUiLang(store, 'es-AR'), 'en');
    saveUiLang(store, 'es');
    assert.equal(loadUiLang(store, 'en-US'), 'es');
  });

  it('sin almacenamiento (bloqueado o lanza): el navegador decide y guardar no rompe', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    assert.equal(loadUiLang(broken, 'en-US'), 'en');
    assert.equal(loadUiLang(null, 'es'), 'es');
    assert.doesNotThrow(() => saveUiLang(broken, 'en'));
    assert.doesNotThrow(() => saveUiLang(null, 'en'));
  });
});
