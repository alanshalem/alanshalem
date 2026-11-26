import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { langCode, LANGS, type Lang } from '../languages.ts';
import { setApiLanguage } from '../api/client.ts';
import { i18nFor, loadUiLang, saveUiLang, uiLangButtonName, type I18n } from './i18n.ts';

export interface UiLanguage extends I18n {
  setLang: (lang: Lang) => void;
}

const UiLanguageContext = createContext<UiLanguage | null>(null);

// Leer `window.localStorage` ya puede lanzar (cookies bloqueadas): sin almacenamiento, `null` (lo usa también el editor).
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Idioma de la interfaz para todo el admin: el elegido (persistido) o el del navegador, y `<html lang>` al día. */
export function UiLanguageProvider({ children }: { children: ReactNode }) {
  // El cliente de la API se sincroniza acá y no en un efecto: los efectos de los hijos (el primer pedido, el chequeo
  // de sesión) corren antes que los del proveedor y saldrían con el idioma por defecto.
  const [lang, setLang] = useState<Lang>(() => {
    const initial = loadUiLang(browserStorage(), navigator.language);
    setApiLanguage(initial);
    return initial;
  });

  // Lectores de pantalla y el corrector del navegador leen la interfaz con el idioma correcto.
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

/** El idioma de la interfaz y sus textos (`t`, `plural`, fechas). Solo dentro de `UiLanguageProvider`. */
export function useUiLanguage(): UiLanguage {
  const value = useContext(UiLanguageContext);
  if (!value) throw new Error('useUiLanguage necesita un UiLanguageProvider arriba.');
  return value;
}

/** Selector "ES | EN" (header y login): botones con aria-pressed, nombrados "ES – Español" (uiLangButtonName). */
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
