import { useDeferredValue, useMemo } from 'react';
import type { Lang } from '../languages.ts';
import { renderPreview } from './preview.ts';

/**
 * The body rendered as on the site, from a deferred value: typing never waits for the render. `markdown` is that same
 * deferred value, so the counter, the outline and the reviewer look at the same thing as the preview.
 */
export function usePostPreview(markdown: string, lang: Lang) {
  const deferred = useDeferredValue(markdown);
  return useMemo(() => ({ markdown: deferred, ...renderPreview(deferred, lang) }), [deferred, lang]);
}
