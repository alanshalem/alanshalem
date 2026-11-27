/*
 * Where a piece of the text falls (in px, inside the textarea's content). A textarea does not expose it and long lines
 * wrap, so its typography and width are copied to an invisible <div> with the same text and measured there (the usual
 * technique to locate a textarea's caret). Used by the synced scroll and find.
 */

const MIRRORED_STYLES = [
  'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize',
] as const;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** A rectangle in the textarea's content coordinates (without subtracting its scroll). */
export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Builds the mirror with `nodes` inside, lets it be measured and removes it from the document. */
function withMirror<T>(textarea: HTMLTextAreaElement, nodes: ReadonlyArray<Node | string>, measure: (mirror: HTMLElement) => T): T {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(textarea);
  for (const property of MIRRORED_STYLES) mirror.style[property] = computed[property];
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    width: `${textarea.clientWidth}px`, // without the scrollbar: where lines really wrap
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    borderWidth: '0',
  });
  mirror.append(...nodes);
  document.body.append(mirror);
  try {
    return measure(mirror);
  } finally {
    mirror.remove();
  }
}

/** A span with the text; empty it would have no position of its own, so it holds a zero-width space. */
function marker(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text || ZERO_WIDTH_SPACE;
  return span;
}

/** The `top` of each offset (ascending) measured from the start of the textarea's content. */
export function measureOffsetTops(textarea: HTMLTextAreaElement, offsets: readonly number[]): number[] {
  const value = textarea.value;
  const markers = offsets.map((offset, i) => marker(value.slice(offset, offsets[i + 1] ?? value.length)));
  return withMirror(textarea, [value.slice(0, offsets[0] ?? 0), ...markers], () => markers.map((span) => span.offsetTop));
}

/** The box of the first line of [from, to): enough to mark a search match. */
export function measureRangeBox(textarea: HTMLTextAreaElement, from: number, to: number): Box {
  const value = textarea.value;
  const span = marker(value.slice(from, to));
  return withMirror(textarea, [value.slice(0, from), span, value.slice(to)], (mirror) => {
    const origin = mirror.getBoundingClientRect();
    const rect = span.getClientRects()[0] ?? span.getBoundingClientRect();
    return { top: rect.top - origin.top, left: rect.left - origin.left, width: rect.width, height: rect.height };
  });
}

/** Scrolls the textarea to `top` if it is not visible, with some room above (without moving anyone's focus). */
export function scrollTextareaTo(textarea: HTMLTextAreaElement, top: number): void {
  const visible = top >= textarea.scrollTop && top < textarea.scrollTop + textarea.clientHeight * 0.8;
  if (!visible) textarea.scrollTop = top - textarea.clientHeight / 3;
}
