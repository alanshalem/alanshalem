import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { editorActions, toolbarLabels } from '../src/editor/actions.ts';
import { rovingIndex } from '../src/editor/roving.ts';
import { ariaKeyShortcut, rememberKey, tabLeavesEditor, type KeyLike } from '../src/editor/shortcuts.ts';
import { i18nFor, uiLangButtonName } from '../src/i18n/i18n.ts';
import { langCode, LANGS } from '../src/languages.ts';
import { pageTitle, type PageView } from '../src/navigation/pageTitle.ts';

/* Accesibilidad por construcción (plataforma-calidad U3, S3): reglas puras que la interfaz usa tal cual. */

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
});

describe('WCAG 2.5.3: el nombre accesible empieza con el texto visible', () => {
  for (const ui of LANGS) {
    const i18n = i18nFor(ui);

    it(`selector de idioma de la interfaz (${ui}): "ES – Español"`, () => {
      for (const lang of LANGS) {
        const name = uiLangButtonName(lang, i18n.t);
        assert.ok(name.startsWith(`${langCode(lang)} – `), name);
        assert.ok(name.endsWith(i18n.t(`lang.label.${lang}`)), name);
      }
    });

    it(`botones de la barra del editor (${ui}): nombre = lo visible y después la descripción`, () => {
      for (const action of editorActions('es').filter((candidate) => candidate.toolbar)) {
        const { face, name } = toolbarLabels(action, i18n.t);
        assert.ok(name.startsWith(face), `${action.id}: "${name}" no empieza con "${face}"`);
        assert.ok(name.includes(i18n.t(action.label)), `${action.id}: falta la descripción en "${name}"`);
      }
    });
  }

  it('ejemplos: H2, 1. y una cara que ya es el comienzo del nombre', () => {
    const { t } = i18nFor('es');
    const byId = (id: string) => editorActions('es').find((action) => action.id === id)!;
    assert.deepEqual(toolbarLabels(byId('heading'), t), { face: 'H2', name: 'H2 – Título' });
    assert.deepEqual(toolbarLabels(byId('numberedList'), t), { face: '1.', name: '1. – Lista numerada' });
    assert.deepEqual(toolbarLabels(byId('figure'), t), { face: 'Figura', name: 'Figura con epígrafe' });
  });
});

describe('el atajo, aparte del nombre: aria-keyshortcuts', () => {
  it('Control en Windows/Linux, Meta en Mac; la letra en mayúscula', () => {
    assert.equal(ariaKeyShortcut({ key: 'x', mod: true, shift: true }, false), 'Control+Shift+X');
    assert.equal(ariaKeyShortcut({ key: 'b', mod: true }, true), 'Meta+B');
    assert.equal(ariaKeyShortcut({ key: 'Enter', mod: true, shift: true }, false), 'Control+Shift+Enter');
  });
});

describe('barra del editor: una sola parada de Tab (tabindex móvil) con flechas, Inicio y Fin', () => {
  it('flechas avanzan y retroceden dando la vuelta', () => {
    assert.equal(rovingIndex(key('ArrowRight'), 0, 5), 1);
    assert.equal(rovingIndex(key('ArrowRight'), 4, 5), 0);
    assert.equal(rovingIndex(key('ArrowLeft'), 0, 5), 4);
    assert.equal(rovingIndex(key('ArrowLeft'), 3, 5), 2);
  });

  it('Inicio y Fin van al primero y al último', () => {
    assert.equal(rovingIndex(key('Home'), 3, 5), 0);
    assert.equal(rovingIndex(key('End'), 1, 5), 4);
  });

  it('otras teclas y combinaciones con modificadores no mueven (quedan para los atajos)', () => {
    assert.equal(rovingIndex(key('Tab'), 1, 5), null);
    assert.equal(rovingIndex(key('a'), 1, 5), null);
    assert.equal(rovingIndex(key('ArrowRight', { ctrlKey: true }), 1, 5), null);
    assert.equal(rovingIndex(key('Home', { altKey: true }), 1, 5), null);
  });

  it('sin botones no hay a dónde ir', () => {
    assert.equal(rovingIndex(key('ArrowRight'), 0, 0), null);
  });
});

describe('WCAG 2.1.2: Esc y después Tab sale del editor (aunque el cursor esté en una lista)', () => {
  it('Tab o Shift+Tab justo después de Esc deja el foco salir', () => {
    assert.equal(tabLeavesEditor(key('Tab'), 'Escape'), true);
    assert.equal(tabLeavesEditor(key('Tab', { shiftKey: true }), 'Escape'), true);
  });

  it('apretar Shift (para Shift+Tab) no borra el Esc; cualquier otra tecla sí', () => {
    assert.equal(rememberKey('Escape', 'Shift'), 'Escape');
    assert.equal(rememberKey('Escape', 'Control'), 'Escape');
    assert.equal(rememberKey('Escape', 'a'), 'a');
    assert.equal(rememberKey(null, 'Escape'), 'Escape');
  });

  it('Tab sin Esc antes sigue anidando la lista', () => {
    assert.equal(tabLeavesEditor(key('Tab'), null), false);
    assert.equal(tabLeavesEditor(key('Tab'), 'a'), false);
    assert.equal(tabLeavesEditor(key('a'), 'Escape'), false);
  });
});

describe('WCAG 2.4.2: un título de documento distinto por vista', () => {
  const views: PageView[] = [
    { name: 'posts' },
    { name: 'new' },
    { name: 'edit', title: 'Hola mundo' },
    { name: 'settings' },
    { name: 'login' },
  ];

  it('en español', () => {
    const { t } = i18nFor('es');
    assert.deepEqual(views.map((view) => pageTitle(view, t)), [
      'Posts · Admin',
      'Nuevo post · Admin',
      'Editar: Hola mundo · Admin',
      'Ajustes · Admin',
      'Entrar · Admin',
    ]);
  });

  it('en inglés', () => {
    const { t } = i18nFor('en');
    assert.equal(pageTitle({ name: 'edit', title: 'Hello' }, t), 'Edit: Hello · Admin');
    assert.equal(pageTitle({ name: 'settings' }, t), 'Settings · Admin');
  });

  it('un post sin título usa "(sin título)" y espacios sobrantes no cuentan', () => {
    const { t } = i18nFor('es');
    assert.equal(pageTitle({ name: 'edit', title: '   ' }, t), 'Editar: (sin título) · Admin');
    assert.equal(pageTitle({ name: 'edit', title: ' Hola ' }, t), 'Editar: Hola · Admin');
  });

  it('todos distintos entre sí', () => {
    const { t } = i18nFor('es');
    const titles = views.map((view) => pageTitle(view, t));
    assert.equal(new Set(titles).size, titles.length);
  });
});

/* WCAG 1.4.11: los bordes de los campos se calculan con los tokens reales (tokens.css + admin.css). */
describe('WCAG 1.4.11: bordes de input/select/textarea ≥ 3:1', () => {
  const css = ['../../../packages/tokens/src/tokens.css', '../src/admin.css']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n');
  const variables = new Map<string, string>();
  for (const [, name = '', value = ''] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (!variables.has(name)) variables.set(name, value.trim());
  }
  const resolve = (value: string): string => {
    const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
    return reference?.[1] ? resolve(variables.get(reference[1]) ?? '') : value.trim();
  };
  const luminance = (hex: string): number => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
      const channel = parseInt(full.slice(i, i + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [high, low] = [luminance(resolve(a)), luminance(resolve(b))].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
  };

  it('la regla de los campos usa --field-border', () => {
    const rule = /input:not\(\[type='file'\]\), textarea, select \{[^}]*\}/.exec(css)?.[0] ?? '';
    assert.match(rule, /border: var\(--border-hairline\) solid var\(--field-border\)/);
  });

  for (const background of ['--bg-surface', '--bg-surface-alt', '--bg-page']) {
    it(`--field-border contra ${background}`, () => {
      const ratio = contrast('var(--field-border)', `var(${background})`);
      assert.ok(ratio >= 3, `${ratio.toFixed(2)}:1`);
    });
  }

  it('con foco el borde cambia (y se distingue del de reposo) sobre el fondo con foco', () => {
    const focus = /input:focus, textarea:focus, select:focus \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const border = /border-color: (var\([\w-]+\))/.exec(focus)?.[1] ?? '';
    assert.ok(border !== '' && resolve(border) !== resolve('var(--field-border)'), focus);
    assert.ok(contrast(border, 'var(--bg-surface-alt)') >= 3);
    assert.ok(contrast(border, 'var(--field-border)') >= 1.5);
  });
});
