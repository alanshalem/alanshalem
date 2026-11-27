import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { siteNameFor } from './seo.ts';

/** The site name (it goes in the <title>; one for both languages); `null` while loading or if it could not load. */
export function useSiteName(): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // It is a visual aid: if it fails, the Google result shows without the name instead of an error.
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
