import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import { i18nFor, loadUiLang, saveUiLang, UI_LANG_STORAGE_KEY } from '../src/i18n/i18n.ts';

/* The admin UI in es/en: one dictionary per language with the same keys, chosen by the user. */

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe('dictionaries: key parity', () => {
  it('es and en have exactly the same keys', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  });

  it('no empty text', () => {
    for (const [lang, dictionary] of Object.entries({ es, en })) {
      for (const [key, text] of Object.entries(dictionary)) assert.notEqual(text.trim(), '', `${lang}: ${key}`);
    }
  });

  it('every translation uses the same {parameters} as the original', () => {
    for (const [key, text] of Object.entries(es)) {
      assert.deepEqual(placeholders(en[key as keyof typeof es]), placeholders(text), key);
    }
  });
});

describe('t: interpolation', () => {
  it('replaces {parameters} with their value', () => {
    assert.equal(i18nFor('es').t('post.confirmDelete', { title: 'Hola' }), '¿Eliminar "Hola"? No se puede deshacer.');
    assert.equal(i18nFor('en').t('post.confirmDelete', { title: 'Hello' }), 'Delete "Hello"? This can’t be undone.');
  });

  it('numbers use the language format: at most one decimal, no thousands separator', () => {
    assert.equal(i18nFor('es').t('video.tooShort', { seconds: 0.6, min: 1 }), 'Dura 0,6 s: el mínimo es 1 s.');
    assert.equal(i18nFor('en').t('video.tooShort', { seconds: 0.6, min: 1 }), 'It’s only 0.6 s long: the minimum is 1 s.');
    assert.equal(
      i18nFor('es').t('validation.tooLong', { subject: 'La URL', max: 2048 }),
      'La URL no puede superar 2048 caracteres.',
    );
  });

  it('a missing parameter stays visible (a visible error, not an empty text)', () => {
    assert.equal(i18nFor('es').t('post.confirmDelete'), '¿Eliminar "{title}"? No se puede deshacer.');
  });
});

describe('plural: one or other', () => {
  it('1 in singular; 0 and the rest in plural, in both languages', () => {
    const spanish = i18nFor('es');
    const english = i18nFor('en');
    assert.deepEqual([0, 1, 2].map((count) => spanish.plural(count, 'posts.published')), ['0 publicados', '1 publicado', '2 publicados']);
    assert.deepEqual([1, 3].map((count) => english.plural(count, 'posts.count')), ['1 post', '3 posts']);
  });
});

describe('formatDate and formatNumber per language (es-AR / en-US)', () => {
  it('medium date', () => {
    assert.equal(i18nFor('es').formatDate('2026-11-25T12:00:00Z'), '25 nov 2026');
    assert.equal(i18nFor('en').formatDate('2026-11-25T12:00:00Z'), 'Nov 25, 2026');
  });

  it('decimals with a comma or a point; with one fixed decimal on request', () => {
    assert.equal(i18nFor('es').formatNumber(2.5), '2,5');
    assert.equal(i18nFor('en').formatNumber(2.5), '2.5');
    assert.equal(i18nFor('es').formatNumber(2, 1), '2,0');
    assert.equal(i18nFor('en').formatNumber(2, 1), '2.0');
  });

  it('i18nFor always returns the same instance per language', () => {
    assert.equal(i18nFor('en'), i18nFor('en'));
    assert.equal(i18nFor('es').lang, 'es');
  });
});

describe('initial language: the stored one; otherwise the browser one (en* → en; the rest → es)', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  };

  it('with nothing stored the browser decides', () => {
    for (const language of ['en', 'en-US', 'en-GB', 'EN-us']) assert.equal(loadUiLang(storage(), language), 'en', language);
    for (const language of ['es', 'es-AR', 'pt-BR', 'fr', '']) assert.equal(loadUiLang(storage(), language), 'es', language);
  });

  it('the stored value beats the browser', () => {
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'es' }), 'en-US'), 'es');
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'en' }), 'es-AR'), 'en');
  });

  it('an unknown stored value is ignored', () => {
    assert.equal(loadUiLang(storage({ [UI_LANG_STORAGE_KEY]: 'fr' }), 'en-US'), 'en');
  });

  it('saveUiLang persists the choice: the next load honors it', () => {
    const store = storage();
    saveUiLang(store, 'en');
    assert.equal(loadUiLang(store, 'es-AR'), 'en');
    saveUiLang(store, 'es');
    assert.equal(loadUiLang(store, 'en-US'), 'es');
  });

  it('without storage (blocked or throwing): the browser decides and saving does not break', () => {
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
