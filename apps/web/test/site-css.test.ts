import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HERO_PLAYING_CLASS } from '../src/lib/hero-rotation.ts';

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

test('sobre las fotos del hero y de la portada, crédito, fecha y temas no usan el gris terciario (WCAG 1.4.3, L4 P1-1)', () => {
  // text-tertiary necesita un overlay de ~0,91 sobre una foto blanca; text-secondary se lee desde ~0,70 (contrast.test.ts).
  assert.match(declarations('.hero-credit'), /color:\s*var\(--text-secondary\)/);
  assert.match(declarations('.article-hero .meta'), /color:\s*var\(--text-secondary\)/);
  // Los temas van arriba del título, donde el overlay es más liviano: en text-primary, como el menú sobre el hero.
  assert.match(declarations('.article-hero .eyebrow'), /color:\s*var\(--text-primary\)/);
});

test('botón Reproducir/Pausar del hero: accesible y oculto hasta que el script lo muestra (S1, L3)', () => {
  // Sin JS (o en una foto) queda `hidden`; su `display` propio no puede ganarle al atributo.
  assert.match(declarations('.hero-toggle[hidden]'), /display:\s*none/);
  const button = declarations('.hero-toggle');
  // WCAG 2.5.8: objetivo de al menos 44 × 44 px (2.75rem).
  assert.match(button, /min-width:\s*2\.75rem/);
  assert.match(button, /min-height:\s*2\.75rem/);
  // Como el botón ☰: borde de 1px translúcido, sin radio; etiqueta en Hanken.
  assert.match(button, /border:\s*1px solid rgba\(237, 237, 234, 0\.4\)/);
  assert.match(button, /border-radius:\s*0/);
  assert.match(button, /font-family:\s*var\(--font-ui\)/);
  // WCAG 2.4.7: foco visible.
  assert.match(declarations('.hero-toggle:focus-visible'), /outline:\s*2px solid/);
  // Un solo texto visible (y en el nombre accesible) según el estado que pone el script; `visibility` y no `display`
  // para que el botón no cambie de ancho al alternar (los dos textos comparten la celda).
  assert.match(declarations(`.hero-toggle.${HERO_PLAYING_CLASS} .hero-toggle-play`), /visibility:\s*hidden/);
  assert.match(declarations(`.hero-toggle:not(.${HERO_PLAYING_CLASS}) .hero-toggle-pause`), /visibility:\s*hidden/);
  // El contenedor de medios del hero no arma caja propia: el guardián lo oculta entero (fondo y botón juntos).
  assert.match(declarations('.hero-media'), /display:\s*contents/);
});
