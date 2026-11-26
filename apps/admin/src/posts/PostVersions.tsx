import { useId } from 'react';
import type { Post } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { useCreateTranslation } from './useCreateTranslation.ts';
import { translationWarnings, versionSlots } from './versions.ts';
import { VersionLink } from './VersionLink.tsx';

interface Props {
  post: Post;
  /** Lo que se está editando: "Sin traducir" se actualiza mientras se escribe. */
  draft: { title: string; body: string };
  /**
   * Con cambios sin guardar, la versión nueva copiaría lo guardado y no lo que se ve: se avisa debajo y, al crearla, se
   * pregunta antes de salir (useCreateTranslation). El botón no se deshabilita: un botón deshabilitado no explica por
   * qué ni se alcanza con Tab.
   */
  dirty: boolean;
  /** La otra versión completa (useOtherVersion, en la página: el editor también la muestra al lado); null si no hay. */
  other: Post | null;
  onError: (error: unknown) => boolean;
}

/**
 * Idioma de un post existente (solo lectura, L4) y sus otras versiones: enlace a cada una o "Crear versión en …".
 * En la traducción, avisa si sigue sin traducir o si el original cambió después (L3).
 */
export function PostVersions({ post, draft, dirty, other, onError }: Props) {
  const id = useId();
  const { t } = useUiLanguage();
  const translation = useCreateTranslation(onError);
  const slots = versionSlots(post.translations, post.lang);
  const warnings = other
    ? translationWarnings({ ...draft, createdAt: post.createdAt, contentUpdatedAt: post.contentUpdatedAt }, other).map((warning) => ({
        title: t(`versions.${warning}.title`),
        text: t(`versions.${warning}.text`, { lang: t(`lang.inSentence.${other.lang}`) }),
      }))
    : [];
  const canCreate = slots.some((slot) => slot.version === null);

  return (
    <section className="post-versions" aria-labelledby={`${id}-versions`}>
      <div className="post-versions-fields">
        <div className="field">
          <span className="label">{t('post.language')}</span>
          <span className="post-lang">{t(`lang.label.${post.lang}`)}</span>
        </div>
        <div className="field">
          <span className="label" id={`${id}-versions`}>
            {t('versions.label')}
          </span>
          <ul className="version-list">
            {slots.map(({ lang, version }) => (
              <li key={lang}>
                {version ? (
                  <VersionLink version={version} />
                ) : (
                  <button
                    type="button"
                    disabled={translation.creating}
                    onClick={() => void translation.create(post.id, lang)}
                  >
                    {translation.creating
                      ? t('versions.creating')
                      : t('versions.create', { lang: t(`lang.inSentence.${lang}`) })}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canCreate && dirty && <p className="help">{t('versions.saveFirst')}</p>}
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
