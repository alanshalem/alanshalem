import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { MEDIA_CONTAINER_ATTRIBUTE, MEDIA_GUARD_SCRIPT } from '../src/lib/media-guard.ts';

/** Elemento mínimo: lo justo que usa el script (tagName, parentNode, lastElementChild, closest, style). */
interface FakeElement {
  tagName: string;
  parentNode: FakeElement | null;
  lastElementChild: FakeElement | null;
  attributes: Set<string>;
  style: { display?: string };
  closest(selector: string): FakeElement | null;
}

function element(tagName: string, parent: FakeElement | null = null, attributes: string[] = []): FakeElement {
  const node: FakeElement = {
    tagName,
    parentNode: parent,
    lastElementChild: null,
    attributes: new Set(attributes),
    style: {},
    closest(selector) {
      const matches = (candidate: FakeElement): boolean =>
        selector === 'picture' ? candidate.tagName === 'PICTURE' : candidate.attributes.has(MEDIA_CONTAINER_ATTRIBUTE);
      for (let current: FakeElement | null = this; current; current = current.parentNode) {
        if (matches(current)) return current;
      }
      return null;
    },
  };
  if (parent) parent.lastElementChild = node;
  return node;
}

/** Ejecuta el script real y devuelve una función que simula el evento `error` (fase de captura) sobre un elemento. */
function loadGuard(): (target: FakeElement) => void {
  let listener: ((event: { target: FakeElement }) => void) | undefined;
  runInNewContext(MEDIA_GUARD_SCRIPT, {
    addEventListener: (type: string, handler: typeof listener, capture: boolean) => {
      assert.equal(type, 'error');
      assert.equal(capture, true, 'los errores de carga no burbujean: hace falta la fase de captura');
      listener = handler;
    },
  });
  assert.ok(listener, 'el script tiene que registrar el listener');
  return (target) => listener!({ target });
}

describe('guardián de medios: una imagen o video que falla nunca se ve roto', () => {
  it('una imagen rota dentro de un contenedor de medios oculta el contenedor entero (fondo negro, sin placeholder)', () => {
    const hero = element('DIV', null, [MEDIA_CONTAINER_ATTRIBUTE]);
    const picture = element('PICTURE', hero);
    const img = element('IMG', picture);
    loadGuard()(img);
    assert.equal(hero.style.display, 'none');
  });

  it('una imagen rota suelta (portada, imagen del post) oculta su <picture>', () => {
    const card = element('DIV');
    const picture = element('PICTURE', card);
    const img = element('IMG', picture);
    loadGuard()(img);
    assert.equal(picture.style.display, 'none');
    assert.equal(card.style.display, undefined, 'el resto de la card queda visible');
  });

  it('un video solo se oculta cuando fallan todas sus fuentes (la última <source>)', () => {
    const hero = element('DIV', null, [MEDIA_CONTAINER_ATTRIBUTE]);
    const video = element('VIDEO', hero);
    const av1 = element('SOURCE', video);
    const h264 = element('SOURCE', video);
    const fire = loadGuard();
    fire(av1);
    assert.equal(hero.style.display, undefined, 'si el AV1 falla todavía queda el H.264');
    fire(h264);
    assert.equal(hero.style.display, 'none');
  });

  it('ignora errores que no son de medios (scripts, links) y <source> de <picture>', () => {
    const script = element('SCRIPT');
    const picture = element('PICTURE');
    const source = element('SOURCE', picture);
    const fire = loadGuard();
    fire(script);
    fire(source);
    assert.equal(script.style.display, undefined);
    assert.equal(picture.style.display, undefined);
  });

  it('es chico: viaja en el <head> de cada página', () => {
    assert.ok(MEDIA_GUARD_SCRIPT.length <= 300, `mide ${MEDIA_GUARD_SCRIPT.length} bytes`);
  });
});
