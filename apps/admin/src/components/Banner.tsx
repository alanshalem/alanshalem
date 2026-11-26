/** Un aviso de resultado: "Guardado." o el error de la API. */
export interface Notice {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

/**
 * El aviso de las páginas (posts, editor, ajustes, fotos del hero): un error es `alert` (se anuncia ya) y un éxito,
 * `status` (se anuncia sin interrumpir). Sin aviso no ocupa lugar.
 */
export function Banner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p className={`banner banner-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}
