import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { langCode, LANGS, type Lang } from '../languages.ts';
import { setApiLanguage } from '../api/client.ts';
import { i18nFor, loadUiLang, saveUiLang, uiLangButtonName, type I18n } from './i18n.ts';

export interface UiLanguage extends I18n {
  setLang: (lang: Lang) => void;
}

const UiLanguageContext = createContext<UiLanguage | null>(null);

// Reading `window.localStorage` can already throw (blocked cookies): without storage, `null` (the editor uses it too).
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** UI language for the whole admin: the chosen one (persisted) or the browser's, keeping `<html lang>` up to date. */
export function UiLanguageProvider({ children }: { children: ReactNode }) {
  // The API client is synced here and not in an effect: the children's effects (the first request, the session
  // check) run before the provider's and would go out with the default language.
  const [lang, setLang] = useState<Lang>(() => {
    const initial = loadUiLang(browserStorage(), navigator.language);
    setApiLanguage(initial);
    return initial;
  });

  // Screen readers and the browser's spell checker read the UI with the right language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<UiLanguage>(
    () => ({
      ...i18nFor(lang),
      setLang: (next) => {
        saveUiLang(browserStorage(), next);
        setApiLanguage(next);
        setLang(next);
      },
    }),
    [lang],
  );

  return <UiLanguageContext value={value}>{children}</UiLanguageContext>;
}

/** The UI language and its texts (`t`, `plural`, dates). Only inside `UiLanguageProvider`. */
export function useUiLanguage(): UiLanguage {
  const value = useContext(UiLanguageContext);
  if (!value) throw new Error('useUiLanguage needs a UiLanguageProvider above it.');
  return value;
}

/** "ES | EN" selector (header and login): aria-pressed buttons named "ES – Español" (uiLangButtonName). */
export function UiLanguageSwitch() {
  const { lang: current, setLang, t } = useUiLanguage();
  return (
    <div className="lang-switch" role="group" aria-label={t('uiLang.label')}>
      {LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={lang === current}
          aria-label={uiLangButtonName(lang, t)}
          onClick={() => setLang(lang)}
        >
          {langCode(lang)}
        </button>
      ))}
    </div>
  );
}
