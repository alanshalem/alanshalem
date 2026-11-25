import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { PostSummary } from '../api/types.ts';
import { href } from '../useRoute.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

export function PostsPage({ onError }: Props) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPosts()
      .then(setPosts)
      .catch((caught: unknown) => {
        if (!onError(caught)) setError('No se pudieron cargar los posts.');
      });
  }, [onError]);

  const published = posts?.filter((post) => post.status === 'published').length ?? 0;

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

      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      {posts === null && !error && <p className="center-note">Cargando…</p>}
      {posts?.length === 0 && (
        <div className="empty-state">
          <p>Todavía no hay posts.</p>
          <a href={href.newPost}>Escribí el primero →</a>
        </div>
      )}

      {posts && posts.length > 0 && (
        <>
          <div className="section-head">
            <h2>Todos</h2>
            <p className="section-note">
              {posts.length} {posts.length === 1 ? 'post' : 'posts'} · {published}{' '}
              {published === 1 ? 'publicado' : 'publicados'}
            </p>
          </div>
          <ol className="post-list">
            {posts.map((post, index) => (
              <li key={post.id}>
                <a href={href.post(post.id)}>
                  <span className="post-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="post-main">
                    <span className="post-title">{post.title || '(sin título)'}</span>
                    <span className="post-slug">/{post.slug}</span>
                  </span>
                  <span className={`chip chip-${post.status}`}>
                    {post.status === 'published' ? 'Publicado' : 'Borrador'}
                  </span>
                  <time className="meta post-date" dateTime={post.updatedAt}>
                    {dateFormat.format(new Date(post.updatedAt))}
                  </time>
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
