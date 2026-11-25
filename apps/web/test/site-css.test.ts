import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Guardas de estilo que no se ven en los tests de HTML. site.css no tiene anidamiento: cada regla es `selector { … }`.
const css = readFileSync(new URL('../src/styles/site.css', import.meta.url), 'utf8');

/** Las declaraciones de la regla cuyo selector es exactamente `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(String.raw`(?:^|[}\s])${escaped}\s*\{([^}]*)\}`, 'm').exec(css);
  assert.ok(rule, `falta la regla ${selector}`);
  return rule[1]!;
}

test('sobre el hero, el idioma no actual del selector ES/EN se lee como el menú y el actual se marca como en el menú', () => {
  // text-tertiary sobre una foto clara casi no se ve (multiidioma L9). El menú usa text-primary sobre el overlay.
  assert.match(declarations('.site-header--overlay .lang-switch a'), /color:\s*var\(--text-primary\)/);
  assert.match(declarations(".site-header--overlay .lang-switch a[aria-current='true']"), /text-decoration:\s*underline/);
  // Sistema de diseño: sin sombras, tampoco en el texto.
  assert.doesNotMatch(css, /text-shadow/);
});
