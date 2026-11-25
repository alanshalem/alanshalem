import type { PostStatus } from '../api/types.ts';
import type { Lang } from '../languages.ts';
import { href } from '../useRoute.ts';
import { versionLabel } from './versions.ts';

interface Props {
  version: { id: string; lang: Lang; status: PostStatus };
}

/** Chip "ES · Publicado" que abre esa versión en el editor (la lista y el bloque "Versiones" lo comparten). */
export function VersionLink({ version }: Props) {
  return (
    <a className={`chip chip-link chip-${version.status}`} href={href.post(version.id)}>
      {versionLabel(version.lang, version.status)}
    </a>
  );
}
