import { rovingIndex } from '../editor/roving.ts';
import type { KeyLike } from '../editor/shortcuts.ts';

/*
 * Tabindex móvil en dos dimensiones (las miniaturas del hero, U7): la grilla es UNA parada de Tab. Izquierda, derecha,
 * Inicio y Fin se comportan como en la barra del editor (`rovingIndex`, la misma regla); arriba y abajo saltan una
 * fila. Las columnas las decide el CSS (auto-fill), así que llegan como parámetro.
 */

/** El índice de la miniatura que recibe el foco con esta tecla, o null si la tecla no es de la grilla. */
export function gridIndex(event: KeyLike, current: number, count: number, columns: number): number | null {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return rovingIndex(event, current, count);
  if (count === 0 || event.ctrlKey || event.metaKey || event.altKey) return null;
  const step = Math.max(1, columns);
  if (event.key === 'ArrowUp') return current - step >= 0 ? current - step : current;
  if (current + step < count) return current + step;
  // Abajo hacia una última fila incompleta: a la última miniatura. En la última fila, se queda.
  const lastRow = Math.floor((count - 1) / step);
  return Math.floor(current / step) < lastRow ? count - 1 : current;
}
