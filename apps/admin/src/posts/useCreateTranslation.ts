import { useCallback, useState } from 'react';
import { api } from '../api/client.ts';
import type { Lang } from '../languages.ts';
import { href, navigate } from '../useRoute.ts';

/**
 * "Crear versión en …" (L3): pide el borrador del otro idioma y abre su editor. La lista y el editor lo comparten.
 * El mensaje de la API (409 si ya existe, en español) se muestra tal cual.
 */
export function useCreateTranslation(onError: (error: unknown) => boolean) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (sourceId: string, lang: Lang): Promise<void> => {
      setCreating(true);
      setError(null);
      try {
        const draft = await api.createTranslation(sourceId, lang);
        navigate(href.post(draft.id));
      } catch (caught) {
        if (!onError(caught)) setError(caught instanceof Error ? caught.message : 'No se pudo crear la versión.');
      } finally {
        setCreating(false);
      }
    },
    [onError],
  );

  return { create, creating, error };
}
