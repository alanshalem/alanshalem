import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { MEDIA_CONTAINER_ATTRIBUTE, MEDIA_GUARD_SCRIPT } from '../src/lib/media-guard.ts';

/** Minimal element: just what the script uses (tagName, parentNode, lastElementChild, closest, style). */
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

/** Runs the real script and returns a function that simulates the `error` event (capture phase) on an element. */
function loadGuard(): (target: FakeElement) => void {
  let listener: ((event: { target: FakeElement }) => void) | undefined;
  runInNewContext(MEDIA_GUARD_SCRIPT, {
    addEventListener: (type: string, handler: typeof listener, capture: boolean) => {
      assert.equal(type, 'error');
      assert.equal(capture, true, 'load errors do not bubble: the capture phase is needed');
      listener = handler;
    },
  });
  assert.ok(listener, 'the script must register the listener');
  return (target) => listener!({ target });
}

describe('media guard: a failing image or video never looks broken', () => {
  it('a broken image inside a media container hides the whole container (black background, no placeholder)', () => {
    const hero = element('DIV', null, [MEDIA_CONTAINER_ATTRIBUTE]);
    const picture = element('PICTURE', hero);
    const img = element('IMG', picture);
    loadGuard()(img);
    assert.equal(hero.style.display, 'none');
  });

  it('a standalone broken image (cover, post image) hides its <picture>', () => {
    const card = element('DIV');
    const picture = element('PICTURE', card);
    const img = element('IMG', picture);
    loadGuard()(img);
    assert.equal(picture.style.display, 'none');
    assert.equal(card.style.display, undefined, 'the rest of the card stays visible');
  });

  it('a video is only hidden when all its sources fail (the last <source>)', () => {
    const hero = element('DIV', null, [MEDIA_CONTAINER_ATTRIBUTE]);
    const video = element('VIDEO', hero);
    const av1 = element('SOURCE', video);
    const h264 = element('SOURCE', video);
    const fire = loadGuard();
    fire(av1);
    assert.equal(hero.style.display, undefined, 'if AV1 fails, H.264 is still left');
    fire(h264);
    assert.equal(hero.style.display, 'none');
  });

  it('ignores errors that are not from media (scripts, links) and a <picture>\'s <source>', () => {
    const script = element('SCRIPT');
    const picture = element('PICTURE');
    const source = element('SOURCE', picture);
    const fire = loadGuard();
    fire(script);
    fire(source);
    assert.equal(script.style.display, undefined);
    assert.equal(picture.style.display, undefined);
  });

  it('is small: it travels in the <head> of every page', () => {
    assert.ok(MEDIA_GUARD_SCRIPT.length <= 300, `measures ${MEDIA_GUARD_SCRIPT.length} bytes`);
  });
});
