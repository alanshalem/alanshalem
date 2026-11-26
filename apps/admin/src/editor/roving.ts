import type { KeyLike } from './shortcuts.ts';

/*
 * "Tabindex móvil" de la barra del editor (WCAG 2.1.1, patrón toolbar de ARIA APG): la barra es UNA parada de Tab y
 * dentro se recorre con las flechas; Inicio y Fin van a los extremos. Así llegar al texto no cuesta 25 Tab.
 */

/** El índice del botón que recibe el foco con esta tecla, o null si la tecla no es de la barra. */
export function rovingIndex(event: KeyLike, current: number, count: number): number | null {
  // Con modificadores son atajos (Ctrl+Fin, Alt+Flecha del navegador): no se tocan.
  if (count === 0 || event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
