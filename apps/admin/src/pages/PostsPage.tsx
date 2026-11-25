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

  return (
    <section>
      <div className="page-head">
        <h1>Posts</h1>
        <a className="primary button-link" href={href.newPost}>
          Nuevo post
        </a>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {posts === null && !error && <p>Cargando…</p>}
      {posts?.length === 0 && <p>Todavía no hay posts. Creá el primero.</p>}

      {posts && posts.length > 0 && (
        <ul className="post-list">
          {posts.map((post) => (
            <li key={post.id}>
              <a href={href.post(post.id)}>
                <span className="post-title">{post.title || '(sin título)'}</span>
                <span className={`badge badge-${post.status}`}>
                  {post.status === 'published' ? 'Publicado' : 'Borrador'}
                </span>
                <time className="meta" dateTime={post.updatedAt}>
                  {dateFormat.format(new Date(post.updatedAt))}
                </time>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
