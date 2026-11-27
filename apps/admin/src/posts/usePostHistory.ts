import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostRevision, PostRevisionSummary } from '../api/types.ts';

export interface PostHistory {
  /** `null` until the panel opens (or while it loads the first time). */
  revisions: PostRevisionSummary[] | null;
  /** The chosen revision, in full (with the body); null if none or still loading. */
  revision: PostRevision | null;
  selectedId: string | null;
  loadFailed: boolean;
  revisionFailed: boolean;
  /** The panel opened: from then on the list loads and stays up to date. */
  open: () => void;
  select: (revisionId: string) => void;
}

/**
 * The history data, on demand: the list only when the panel opens and each revision when chosen (the body can be
 * long). `contentVersion` (the post's `contentUpdatedAt`) changes with every save or restore that creates a revision:
 * then the list is fetched again.
 */
export function usePostHistory(postId: string, contentVersion: string, onError: (error: unknown) => boolean): PostHistory {
  const [opened, setOpened] = useState(false);
  const [revisions, setRevisions] = useState<PostRevisionSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revision, setRevision] = useState<PostRevision | null>(null);
  const [revisionFailed, setRevisionFailed] = useState(false);
  // The last requested revision: with quick clicks, an old response does not overwrite the new one.
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
