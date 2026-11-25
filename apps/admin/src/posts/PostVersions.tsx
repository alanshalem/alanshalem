import { useId } from 'react';
import type { Post } from '../api/types.ts';
import { LANG_IN_SENTENCE, LANG_LABELS, type Lang } from '../languages.ts';
import { useCreateTranslation } from './useCreateTranslation.ts';
import { useOtherVersion } from './useOtherVersion.ts';
import { translationWarnings, versionSlots, type TranslationWarning } from './versions.ts';
import { VersionLink } from './VersionLink.tsx';

interface Props {
  post: Post;
  /** Lo que se está editando: "Sin traducir" se actualiza mientras se escribe. */
  draft: { title: string; body: string };
  /** Con cambios sin guardar no se crea otra versión: copiaría lo guardado, no lo que se ve. */
  dirty: boolean;
  onError: (error: unknown) => boolean;
}

const WARNINGS: Record<TranslationWarning, (otherLang: Lang) => { title: string; text: string }> = {
  untranslated: (lang) => ({
    title: 'Sin traducir.',
    text: `El título o el texto siguen iguales a la versión en ${LANG_IN_SENTENCE[lang]}: traducilos antes de publicar.`,
  }),
  outdated: (lang) => ({
    title: 'Desactualizada.',
    text: `La versión en ${LANG_IN_SENTENCE[lang]} cambió después de la última edición de esta: pasá esos cambios acá y guardá.`,
  }),
};

/**
 * Idioma de un post existente (solo lectura, L4) y sus otras versiones: enlace a cada una o "Crear versión en …".
 * En la traducción, avisa si sigue sin traducir o si el original cambió después (L3).
 */
export function PostVersions({ post, draft, dirty, onError }: Props) {
  const id = useId();
  const translation = useCreateTranslation(onError);
  const other = useOtherVersion(post.translations[0]?.id ?? null, onError);
  const slots = versionSlots(post.translations, post.lang);
  const warnings = other
    ? translationWarnings({ ...draft, createdAt: post.createdAt, updatedAt: post.updatedAt }, other).map((warning) =>
        WARNINGS[warning](other.lang),
      )
    : [];
  const canCreate = slots.some((slot) => slot.version === null);

  return (
    <section className="post-versions" aria-labelledby={`${id}-versions`}>
      <div className="post-versions-fields">
        <div className="field">
          <span className="label">Idioma</span>
          <span className="post-lang">{LANG_LABELS[post.lang]}</span>
        </div>
        <div className="field">
          <span className="label" id={`${id}-versions`}>
            Versiones
          </span>
          <ul className="version-list">
            {slots.map(({ lang, version }) => (
              <li key={lang}>
                {version ? (
                  <VersionLink version={version} />
                ) : (
                  <button
                    type="button"
                    disabled={translation.creating || dirty}
                    onClick={() => void translation.create(post.id, lang)}
                  >
                    {translation.creating ? 'Creando…' : `Crear versión en ${LANG_IN_SENTENCE[lang]}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canCreate && dirty && <p className="help">Guardá los cambios antes: la versión nueva parte de lo guardado.</p>}
          {translation.error && (
            <p className="field-error" role="alert">
              {translation.error}
            </p>
          )}
        </div>
      </div>
      {warnings.map(({ title, text }) => (
        <p key={title} className="banner banner-warning">
          <strong>{title}</strong> {text}
        </p>
      ))}
    </section>
  );
}
