import { useCallback, useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage } from '../api/problem.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { confirmNavigation, href, navigate } from '../useRoute.ts';

/**
 * "Crear versión en …" (L3): pide el borrador del otro idioma y abre su editor. La lista y el editor lo comparten.
 * El mensaje de la API (409 si ya existe, en español) se muestra tal cual. Con cambios sin guardar se pregunta antes
 * de crearla (se sale del editor); después se navega sin volver a preguntar.
 */
export function useCreateTranslation(onError: (error: unknown) => boolean) {
  const { t } = useUiLanguage();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (sourceId: string, lang: Lang): Promise<void> => {
      if (!confirmNavigation(null)) return;
      setCreating(true);
      setError(null);
      try {
        const draft = await api.createTranslation(sourceId, lang);
        navigate(href.post(draft.id), { confirmed: true });
      } catch (caught) {
        if (!onError(caught)) setError(errorMessage(caught, t('versions.createError')));
      } finally {
        setCreating(false);
      }
    },
    [onError, t],
  );

  return { create, creating, error };
}
