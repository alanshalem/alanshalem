import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { Post } from '../api/types.ts';

/**
 * The full other version (with title and body) to compare the translation with. `null` while loading or if there is
 * no other version. With two fixed languages there is at most one.
 */
export function useOtherVersion(otherId: string | null, onError: (error: unknown) => boolean): Post | null {
  const [other, setOther] = useState<Post | null>(null);

  useEffect(() => {
    if (otherId === null) return;
    let active = true;
    api.getPost(otherId).then(
      (loaded) => active && setOther(loaded),
      // The warnings are a help: if the other version cannot load, the editor carries on without them.
      (caught: unknown) => onError(caught),
    );
    return () => {
      active = false;
    };
  }, [otherId, onError]);

  // If `otherId` changed, what was loaded before is no longer the other version.
  return other?.id === otherId ? other : null;
}
