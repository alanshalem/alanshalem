import { useDeferredValue, useMemo } from 'react';
import type { Lang } from '../languages.ts';
import { renderPreview } from './preview.ts';

/**
 * El cuerpo renderizado como en el sitio, a partir de un valor diferido: tipear nunca espera al render. `markdown` es
 * ese mismo valor diferido, para que el contador, el esquema y el revisor miren lo mismo que la vista previa.
 */
export function usePostPreview(markdown: string, lang: Lang) {
  const deferred = useDeferredValue(markdown);
  return useMemo(() => ({ markdown: deferred, ...renderPreview(deferred, lang) }), [deferred, lang]);
}
