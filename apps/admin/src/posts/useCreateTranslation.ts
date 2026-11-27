import { useCallback, useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage } from '../api/problem.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { confirmNavigation, href, navigate } from '../useRoute.ts';

/**
 * "Crear versión en …": requests the draft in the other language and opens its editor. Shared by the list and the
 * editor. The API message (409 if it already exists, already in the UI language through Accept-Language) is shown as
 * is. With unsaved changes it asks before creating it (it leaves the editor); afterwards it navigates without asking
 * again.
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
