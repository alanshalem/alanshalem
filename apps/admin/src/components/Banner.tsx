/** A result notice: "Guardado." or the API error. */
export interface Notice {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

/**
 * The pages' notice (posts, editor, settings, hero photos): an error is an `alert` (announced right away) and a
 * success a `status` (announced without interrupting). Without a notice it takes no space.
 */
export function Banner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p className={`banner banner-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}
