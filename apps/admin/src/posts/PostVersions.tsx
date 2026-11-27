import { useId } from 'react';
import type { Post } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { useCreateTranslation } from './useCreateTranslation.ts';
import { translationWarnings, versionSlots } from './versions.ts';
import { VersionLink } from './VersionLink.tsx';

interface Props {
  post: Post;
  /** What is being edited: "Sin traducir" updates while typing. */
  draft: { title: string; body: string };
  /**
   * With unsaved changes, the new version would copy what is saved and not what is shown: a warning shows below and,
   * on create, it asks before leaving (useCreateTranslation). The button is not disabled: a disabled button does not
   * explain why and cannot be reached with Tab.
   */
  dirty: boolean;
  /** The full other version (useOtherVersion, in the page: the editor also shows it alongside); null if none. */
  other: Post | null;
  onError: (error: unknown) => boolean;
}

/**
 * The language of an existing post (read-only) and its other versions: a link to each or "Crear versión en …".
 * In the translation, it warns if it is still untranslated or if the original changed afterwards.
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
