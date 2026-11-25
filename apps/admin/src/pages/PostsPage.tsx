import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostSummary } from '../api/types.ts';
import { LANG_IN_SENTENCE } from '../languages.ts';
import { useCreateTranslation } from '../posts/useCreateTranslation.ts';
import { groupPosts, versionLabel, versionSlots } from '../posts/versions.ts';
import { VersionLink } from '../posts/VersionLink.tsx';
import { href } from '../useRoute.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

export function PostsPage({ onError }: Props) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const translation = useCreateTranslation(onError);

  useEffect(() => {
    api
      .listPosts()
      .then(setPosts)
      .catch((caught: unknown) => {
        if (!onError(caught)) setError('No se pudieron cargar los posts.');
      });
  }, [onError]);

  // Una fila por post, con un chip por idioma (L3): las versiones de un mismo post comparten grupo.
  const groups = posts ? groupPosts(posts) : [];
  const published = groups.filter((group) => group.versions.some((version) => version.status === 'published')).length;
  const problem = error ?? translation.error;

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">Escritura</p>
          <h1 className="page-title">Posts</h1>
        </div>
        <a className="primary button-link" href={href.newPost}>
          Nuevo post
        </a>
      </div>

      {problem && (
        <p className="banner banner-error" role="alert">
          {problem}
        </p>
      )}
      {posts === null && !error && <p className="center-note">Cargando…</p>}
      {posts?.length === 0 && (
        <div className="empty-state">
          <p>Todavía no hay posts.</p>
          <a href={href.newPost}>Escribí el primero →</a>
        </div>
      )}

      {groups.length > 0 && (
        <>
          <div className="section-head">
            <h2>Todos</h2>
            <p className="section-note">
              {groups.length} {groups.length === 1 ? 'post' : 'posts'} · {published}{' '}
              {published === 1 ? 'publicado' : 'publicados'}
            </p>
          </div>
          <ol className="post-list">
            {groups.map((group, index) => (
              <li key={group.id} className="post-row">
                <span className="post-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <a className="post-main" href={href.post(group.main.id)}>
                  <span className="post-title">{group.main.title || '(sin título)'}</span>
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
                        aria-label={`${versionLabel(lang, null)}: crear versión en ${LANG_IN_SENTENCE[lang]}`}
                        onClick={() => void translation.create(group.main.id, lang)}
                      >
                        {versionLabel(lang, null)}
                      </button>
                    ),
                  )}
                </span>
                <time className="meta post-date" dateTime={group.updatedAt}>
                  {dateFormat.format(new Date(group.updatedAt))}
                </time>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
