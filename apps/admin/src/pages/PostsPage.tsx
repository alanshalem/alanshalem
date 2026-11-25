import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostSummary } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { useCreateTranslation } from '../posts/useCreateTranslation.ts';
import { groupPosts, versionLabel, versionSlots } from '../posts/versions.ts';
import { VersionLink } from '../posts/VersionLink.tsx';
import { href } from '../useRoute.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

export function PostsPage({ onError }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const translation = useCreateTranslation(onError);

  useEffect(() => {
    api
      .listPosts()
      .then(setPosts)
      .catch((caught: unknown) => {
        if (!onError(caught)) setLoadFailed(true);
      });
  }, [onError]);

  // Una fila por post, con un chip por idioma (L3): las versiones de un mismo post comparten grupo.
  const groups = posts ? groupPosts(posts) : [];
  const published = groups.filter((group) => group.versions.some((version) => version.status === 'published')).length;
  const problem = loadFailed ? t('posts.loadError') : translation.error;

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">{t('posts.eyebrow')}</p>
          <h1 className="page-title">{t('nav.posts')}</h1>
        </div>
        <a className="primary button-link" href={href.newPost}>
          {t('post.new')}
        </a>
      </div>

      {problem && (
        <p className="banner banner-error" role="alert">
          {problem}
        </p>
      )}
      {posts === null && !loadFailed && <p className="center-note">{t('common.loading')}</p>}
      {posts?.length === 0 && (
        <div className="empty-state">
          <p>{t('posts.empty')}</p>
          <a href={href.newPost}>{t('posts.writeFirst')}</a>
        </div>
      )}

      {groups.length > 0 && (
        <>
          <div className="section-head">
            <h2>{t('posts.all')}</h2>
            <p className="section-note">
              {i18n.plural(groups.length, 'posts.count')} · {i18n.plural(published, 'posts.published')}
            </p>
          </div>
          <ol className="post-list">
            {groups.map((group, index) => (
              <li key={group.id} className="post-row">
                <span className="post-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <a className="post-main" href={href.post(group.main.id)}>
                  <span className="post-title">{group.main.title || t('common.untitled')}</span>
                  <span className="post-slug">/{group.main.slug}</span>
                </a>
                <span className="post-langs">
                  {versionSlots(group.versions).map(({ lang, version }) =>
                    version ? (
                      <VersionLink key={lang} version={version} />
                    ) : (
                      <button
                        key={lang}
                        type="button"
                        className="chip chip-missing"
                        disabled={translation.creating}
                        aria-label={t('versions.createAria', {
                          chip: versionLabel(lang, null, i18n),
                          lang: t(`lang.inSentence.${lang}`),
                        })}
                        onClick={() => void translation.create(group.main.id, lang)}
                      >
                        {versionLabel(lang, null, i18n)}
                      </button>
                    ),
                  )}
                </span>
                <time className="meta post-date" dateTime={group.updatedAt}>
                  {i18n.formatDate(group.updatedAt)}
                </time>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
