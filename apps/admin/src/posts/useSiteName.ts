import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { Lang } from '../languages.ts';
import { siteNameFor } from './seo.ts';

/** El nombre del sitio en el idioma del post (va en el <title>); `null` mientras carga o si no se pudo cargar. */
export function useSiteName(lang: Lang): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Es una ayuda visual: si falla, el resultado de Google se muestra sin el nombre en vez de un error.
    api.getSettings().then(
      (settings) => active && setName(siteNameFor(settings, lang)),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [lang]);

  return name;
}
