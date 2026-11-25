import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { Post } from '../api/types.ts';

/**
 * La otra versión completa (con título y cuerpo) para comparar la traducción con ella. `null` mientras carga o
 * si no hay otra versión. Con dos idiomas fijos (L3) hay a lo sumo una.
 */
export function useOtherVersion(otherId: string | null, onError: (error: unknown) => boolean): Post | null {
  const [other, setOther] = useState<Post | null>(null);

  useEffect(() => {
    if (otherId === null) return;
    let active = true;
    api.getPost(otherId).then(
      (loaded) => active && setOther(loaded),
      // Los avisos son una ayuda: si no se puede cargar la otra versión, el editor sigue sin ellos.
      (caught: unknown) => onError(caught),
    );
    return () => {
      active = false;
    };
  }, [otherId, onError]);

  // Si cambió `otherId`, lo cargado antes ya no es la otra versión.
  return other?.id === otherId ? other : null;
}
