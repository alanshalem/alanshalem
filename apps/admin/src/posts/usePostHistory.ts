import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostRevision, PostRevisionSummary } from '../api/types.ts';

export interface PostHistory {
  /** `null` hasta que se abre el panel (o mientras carga la primera vez). */
  revisions: PostRevisionSummary[] | null;
  /** La versión elegida, completa (con el cuerpo); null si no hay ninguna o todavía carga. */
  revision: PostRevision | null;
  selectedId: string | null;
  loadFailed: boolean;
  revisionFailed: boolean;
  /** El panel se abrió: desde ahí la lista se carga y se mantiene al día. */
  open: () => void;
  select: (revisionId: string) => void;
}

/**
 * Los datos del historial, a pedido: la lista recién cuando se abre el panel y cada versión cuando se elige (el cuerpo
 * puede ser largo). `contentVersion` (el `contentUpdatedAt` del post) cambia con cada guardado o restauración que
 * crea una versión: entonces la lista se vuelve a pedir.
 */
export function usePostHistory(postId: string, contentVersion: string, onError: (error: unknown) => boolean): PostHistory {
  const [opened, setOpened] = useState(false);
  const [revisions, setRevisions] = useState<PostRevisionSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revision, setRevision] = useState<PostRevision | null>(null);
  const [revisionFailed, setRevisionFailed] = useState(false);
  // La última versión pedida: con clics rápidos, una respuesta vieja no pisa a la nueva.
  const requested = useRef<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    api.listRevisions(postId).then(
      (loaded) => {
        if (!active) return;
        setRevisions(loaded);
        setLoadFailed(false);
      },
      (caught: unknown) => {
        if (active && !onError(caught)) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [opened, postId, contentVersion, onError]);

  const select = (revisionId: string): void => {
    requested.current = revisionId;
    setSelectedId(revisionId);
    setRevision(null);
    setRevisionFailed(false);
    api.getRevision(postId, revisionId).then(
      (loaded) => requested.current === revisionId && setRevision(loaded),
      (caught: unknown) => {
        if (requested.current === revisionId && !onError(caught)) setRevisionFailed(true);
      },
    );
  };

  return { revisions, revision, selectedId, loadFailed, revisionFailed, open: () => setOpened(true), select };
}
