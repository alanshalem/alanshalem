import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostSummary } from '../api/types.ts';
import { Banner } from '../components/Banner.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { pageTitle } from '../navigation/pageTitle.ts';
import { scheduledAt, scheduledLabel } from '../posts/schedule.ts';
import { useCreateTranslation } from '../posts/useCreateTranslation.ts';
import { groupPosts, missingVersion, versionSlots } from '../posts/versions.ts';
import { VersionLink } from '../posts/VersionLink.tsx';
import { href } from '../useRoute.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

/** "Programado · 1 dic 2026, 09:00" junto al chip de esa versión, si es un borrador programado. */
function ScheduledChip({ version }: { version: PostSummary }) {
  const i18n = useUiLanguage();
  const at = scheduledAt(version);
  if (at === null) return null;
  return (
    <time className="chip chip-scheduled" dateTime={at}>
      {scheduledLabel(at, i18n)}
    </time>
  );
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
      <PageHead
        heading={t('nav.posts')}
        documentTitle={pageTitle({ name: 'posts' }, t)}
        above={<p className="eyebrow">{t('posts.eyebrow')}</p>}
      >
        <a className="primary button-link" href={href.newPost}>
          {t('post.new')}
        </a>
      </PageHead>

      <Banner notice={problem ? { kind: 'error', text: problem } : null} />
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
                      <Fragment key={lang}>
                        <VersionLink version={version} />
                        <ScheduledChip version={version} />
                      </Fragment>
                    ) : (
                      <button
                        key={lang}
                        type="button"
                        className="chip chip-missing"
                        disabled={translation.creating}
                        aria-label={missingVersion(lang, i18n).label}
                        onClick={() => void translation.create(group.main.id, lang)}
                      >
                        {missingVersion(lang, i18n).text}
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
