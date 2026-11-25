/*
 * Dónde cae (en px, dentro del contenido del textarea) un pedazo del texto. Un textarea no lo expone y las líneas
 * largas se parten, así que se copia su tipografía y ancho en un <div> invisible con el mismo texto y se mide ahí
 * (la técnica de siempre para ubicar el cursor de un textarea). Lo usan el scroll sincronizado y buscar.
 */

const MIRRORED_STYLES = [
  'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize',
] as const;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** Un rectángulo en coordenadas del contenido del textarea (sin restar su scroll). */
export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Arma el espejo con `nodes` adentro, deja medir y lo saca del documento. */
function withMirror<T>(textarea: HTMLTextAreaElement, nodes: ReadonlyArray<Node | string>, measure: (mirror: HTMLElement) => T): T {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(textarea);
  for (const property of MIRRORED_STYLES) mirror.style[property] = computed[property];
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    width: `${textarea.clientWidth}px`, // sin la barra de scroll: donde de verdad se parten las líneas
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

/** Un span con el texto; vacío no tendría posición propia, así que lleva un espacio de ancho cero. */
function marker(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text || ZERO_WIDTH_SPACE;
  return span;
}

/** El `top` de cada offset (ascendentes) medido desde el principio del contenido del textarea. */
export function measureOffsetTops(textarea: HTMLTextAreaElement, offsets: readonly number[]): number[] {
  const value = textarea.value;
  const markers = offsets.map((offset, i) => marker(value.slice(offset, offsets[i + 1] ?? value.length)));
  return withMirror(textarea, [value.slice(0, offsets[0] ?? 0), ...markers], () => markers.map((span) => span.offsetTop));
}

/** La caja de la primera línea de [from, to): alcanza para marcar una coincidencia de búsqueda. */
export function measureRangeBox(textarea: HTMLTextAreaElement, from: number, to: number): Box {
  const value = textarea.value;
  const span = marker(value.slice(from, to));
  return withMirror(textarea, [value.slice(0, from), span, value.slice(to)], (mirror) => {
    const origin = mirror.getBoundingClientRect();
    const rect = span.getClientRects()[0] ?? span.getBoundingClientRect();
    return { top: rect.top - origin.top, left: rect.left - origin.left, width: rect.width, height: rect.height };
  });
}

/** Lleva el scroll del textarea a `top` si no se ve, con un poco de aire arriba (sin moverle el foco a nadie). */
export function scrollTextareaTo(textarea: HTMLTextAreaElement, top: number): void {
  const visible = top >= textarea.scrollTop && top < textarea.scrollTop + textarea.clientHeight * 0.8;
  if (!visible) textarea.scrollTop = top - textarea.clientHeight / 3;
}
