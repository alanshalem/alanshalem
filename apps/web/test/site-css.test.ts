import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HERO_PLAYING_CLASS } from '../src/lib/hero-rotation.ts';

// Style guards that the HTML tests do not see. site.css has no nesting: every rule is `selector { … }`.
const css = readFileSync(new URL('../src/styles/site.css', import.meta.url), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(String.raw`(?:^|[}\s])${escaped}\s*\{([^}]*)\}`, 'm').exec(css);
  assert.ok(rule, `missing rule ${selector}`);
  return rule[1]!;
}

test('over the hero, the non-current language of the ES/EN switcher reads like the menu and the current one is marked like in the menu', () => {
  // text-tertiary is barely visible over a light photo. The menu uses text-primary over the overlay.
  assert.match(declarations('.site-header--overlay .lang-switch a'), /color:\s*var\(--text-primary\)/);
  assert.match(declarations(".site-header--overlay .lang-switch a[aria-current='true']"), /text-decoration:\s*underline/);
  // Design system: no shadows, not on text either.
  assert.doesNotMatch(css, /text-shadow/);
});

test('over the hero and cover photos, credit, date and topics do not use the tertiary gray (WCAG 1.4.3)', () => {
  // text-tertiary needs a ~0.91 overlay over a white photo; text-secondary reads from ~0.70 (contrast.test.ts).
  assert.match(declarations('.hero-credit'), /color:\s*var\(--text-secondary\)/);
  assert.match(declarations('.article-hero .meta'), /color:\s*var\(--text-secondary\)/);
  // The topics go above the title, where the overlay is lighter: in text-primary, like the menu over the hero.
  assert.match(declarations('.article-hero .eyebrow'), /color:\s*var\(--text-primary\)/);
});

test('hero Play/Pause button: accessible and hidden until the script shows it', () => {
  // Without JS (or for a photo) it stays `hidden`; its own `display` cannot win over the attribute.
  assert.match(declarations('.hero-toggle[hidden]'), /display:\s*none/);
  const button = declarations('.hero-toggle');
  // WCAG 2.5.8: a target of at least 44 × 44 px (2.75rem).
  assert.match(button, /min-width:\s*2\.75rem/);
  assert.match(button, /min-height:\s*2\.75rem/);
  // Like the ☰ button: a translucent 1px border, no radius; label in Hanken.
  assert.match(button, /border:\s*1px solid rgba\(237, 237, 234, 0\.4\)/);
  assert.match(button, /border-radius:\s*0/);
  assert.match(button, /font-family:\s*var\(--font-ui\)/);
  // WCAG 2.4.7: visible focus.
  assert.match(declarations('.hero-toggle:focus-visible'), /outline:\s*2px solid/);
  // A single visible text (and in the accessible name) by the state the script sets; `visibility`, not `display`, so
  // the button does not change width when toggled (both texts share the cell).
  assert.match(declarations(`.hero-toggle.${HERO_PLAYING_CLASS} .hero-toggle-play`), /visibility:\s*hidden/);
  assert.match(declarations(`.hero-toggle:not(.${HERO_PLAYING_CLASS}) .hero-toggle-pause`), /visibility:\s*hidden/);
  // The hero's media container makes no box of its own: the guard hides it whole (background and button together).
  assert.match(declarations('.hero-media'), /display:\s*contents/);
});

test('topic tiles: a veil behind the text with the same token as the hero (WCAG 1.4.3: 1.7:1 → 9.1:1 in Chrome)', () => {
  assert.match(declarations('.tile-body::before'), /background:\s*var\(--overlay-hero-text\)/);
  assert.match(declarations('.tile-body'), /z-index:\s*0/);
  assert.match(declarations('.tile'), /overflow:\s*hidden/);
});

test('header: no `order` in any rule, what is seen follows the HTML and Tab order (WCAG 2.4.3)', () => {
  assert.doesNotMatch(css, /(?:^|[;{\s])order:/m);
  assert.match(css, /\.site-nav a\[aria-current\] \{/);
});

test('header: links in the row from 900px and in the ☰ panel below that', () => {
  // Below 900px: the row of links is not shown (nor focusable) and the panel only while the ☰ is open.
  assert.match(declarations('.site-nav--bar'), /display:\s*none/);
  assert.match(declarations('.site-nav--menu'), /display:\s*none/);
  assert.match(declarations(".nav-toggle[aria-expanded='true'] + .site-nav--menu"), /display:\s*flex/);
  // From 900px, the opposite: the row of links and neither ☰ nor panel (even if left open before widening the window).
  const wide = /@media \(min-width: 900px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(wide, /\.site-nav--bar \{[^}]*display:\s*flex/);
  assert.match(wide, /\.nav-toggle, \.nav-toggle\[aria-expanded='true'\] \+ \.site-nav--menu \{[^}]*display:\s*none/);
});
