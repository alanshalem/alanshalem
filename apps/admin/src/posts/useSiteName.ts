import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { siteNameFor } from './seo.ts';

/** El nombre del sitio (va en el <title>; uno solo en los dos idiomas, L12); `null` mientras carga o si no se pudo cargar. */
export function useSiteName(): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Es una ayuda visual: si falla, el resultado de Google se muestra sin el nombre en vez de un error.
    api.getSettings().then(
      (settings) => active && setName(siteNameFor(settings)),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  return name;
}
