import { useEffect, useState } from 'react';
import { browserStorage } from '../i18n/UiLanguage.tsx';
import { loadViewPrefs, saveViewPrefs, type EditorView, type ViewPrefs } from './view.ts';

/** Vista y modo foco del editor, recordados en localStorage (S2). */
export function useEditorView() {
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadViewPrefs(browserStorage()));

  useEffect(() => saveViewPrefs(browserStorage(), prefs), [prefs]);

  return {
    ...prefs,
    setView: (view: EditorView) => setPrefs((current) => ({ ...current, view })),
    setFocus: (focus: boolean) => setPrefs((current) => ({ ...current, focus })),
  };
}
