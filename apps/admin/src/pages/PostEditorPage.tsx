import { slugify } from '@blog/markdown';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Post, PostInput } from '../api/types.ts';
import { ImageField } from '../components/ImageField.tsx';
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx';
import { validateCover } from '../settings/validate.ts';
import { href, navigate } from '../useRoute.ts'; // navigate: solo al eliminar

interface Props {
  /** `null` = post nuevo. */
  postId: string | null;
  onError: (error: unknown) => boolean;
}

interface Form {
  title: string;
  slug: string;
  summary: string;
  tags: string; // separados por coma en la UI
  body: string;
  coverUrl: string;
  coverAlt: string;
}

const EMPTY_FORM: Form = { title: '', slug: '', summary: '', tags: '', body: '', coverUrl: '', coverAlt: '' };

const toForm = (post: Post): Form => ({
  title: post.title,
  slug: post.slug,
  summary: post.summary,
  tags: post.tags.join(', '),
  body: post.body,
  coverUrl: post.coverUrl ?? '',
  coverAlt: post.coverAlt ?? '',
});

/** La portada ya validada y normalizada por `validateCover` (vacío = null). */
const toInput = (form: Form, cover: Pick<PostInput, 'coverUrl' | 'coverAlt'>): PostInput => ({
  title: form.title.trim(),
  slug: form.slug.trim(),
  summary: form.summary.trim(),
  body: form.body,
  tags: form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),
  ...cover,
});

export function PostEditorPage({ postId, onError }: Props) {
  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saved, setSaved] = useState<string>(JSON.stringify(EMPTY_FORM)); // para detectar cambios sin guardar
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(postId !== null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== saved;

  useEffect(() => {
    if (postId === null) return;
    api
      .getPost(postId)
      .then((loaded) => {
        const loadedForm = toForm(loaded);
        setPost(loaded);
        setForm(loadedForm);
        setSaved(JSON.stringify(loadedForm));
        setSlugTouched(true); // un post existente conserva su slug aunque cambie el título
      })
      .catch((caught: unknown) => {
        if (!onError(caught)) setMessage({ kind: 'error', text: 'No se pudo cargar el post.' });
      })
      .finally(() => setLoading(false));
  }, [postId, onError]);

  // Aviso del navegador si se intenta cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((current) => ({ ...current, [key]: value }));

  const handleTitleChange = (title: string): void => {
    setForm((current) => ({ ...current, title, slug: slugTouched ? current.slug : slugify(title) }));
  };

  /** Guarda (crea o actualiza) y devuelve el post resultante, o null si falló. */
  const save = useCallback(async (): Promise<Post | null> => {
    if (form.title.trim() === '') {
      setMessage({ kind: 'error', text: 'El título es obligatorio.' });
      return null;
    }
    const cover = validateCover(form.coverUrl, form.coverAlt);
    if (!cover.ok) {
      setCoverError(cover.error);
      setMessage({ kind: 'error', text: cover.error });
      return null;
    }
    setCoverError(null);
    setBusy(true);
    setMessage(null);
    try {
      const input = toInput(form, { coverUrl: cover.coverUrl, coverAlt: cover.coverAlt });
      const result = post ? await api.updatePost(post.id, input) : await api.createPost(input);
      const resultForm = toForm(result);
      setPost(result);
      setForm(resultForm);
      setSaved(JSON.stringify(resultForm));
      // El post nuevo pasa a tener su propia URL. replaceState (y no navigate) para no disparar
      // hashchange: remontaría la página en medio de un "Publicar" y perdería el mensaje de resultado.
      if (!post) window.history.replaceState(null, '', href.post(result.id));
      setMessage({ kind: 'ok', text: 'Guardado.' });
      return result;
    } catch (caught) {
      if (!onError(caught)) {
        setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : 'No se pudo guardar.' });
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [form, post, onError]);

  // Ctrl/Cmd+S guarda. El ref evita re-registrar el listener en cada tecla.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handlePublish = async (): Promise<void> => {
    const current = await save();
    if (!current) return;
    setBusy(true);
    try {
      setPost(await api.publishPost(current.id));
      setMessage({ kind: 'ok', text: 'Publicado. El sitio se está regenerando; en unos segundos estará online.' });
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: 'No se pudo publicar.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    if (!post) return;
    setBusy(true);
    try {
      setPost(await api.unpublishPost(post.id));
      setMessage({ kind: 'ok', text: 'Vuelto a borrador. El sitio se está regenerando.' });
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: 'No se pudo despublicar.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!post || !window.confirm(`¿Eliminar "${post.title}"? No se puede deshacer.`)) return;
    setBusy(true);
    try {
      await api.deletePost(post.id);
      setSaved(JSON.stringify(form)); // evita el aviso de cambios sin guardar al salir
      navigate(href.posts);
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: 'No se pudo eliminar.' });
      setBusy(false);
    }
  };

  if (loading) return <p>Cargando…</p>;

  const isPublished = post?.status === 'published';

  return (
    <section className="post-editor">
      <div className="page-head page-head-sticky">
        <div>
          <a className="back-link" href={href.posts}>
            ← Posts
          </a>
          <h1 className="page-title">{post ? post.title || '(sin título)' : 'Nuevo post'}</h1>
        </div>
        <div className="actions">
          <span className="meta">{dirty ? 'Cambios sin guardar' : post ? 'Todo guardado' : ''}</span>
          {post && (
            <span className={`chip chip-${post.status}`}>{isPublished ? 'Publicado' : 'Borrador'}</span>
          )}
          <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
            Guardar
          </button>
          {isPublished ? (
            <button type="button" disabled={busy} onClick={() => void handleUnpublish()}>
              Despublicar
            </button>
          ) : null}
          <button type="button" className="primary" disabled={busy} onClick={() => void handlePublish()}>
            {isPublished ? 'Guardar y republicar' : 'Publicar'}
          </button>
        </div>
      </div>

      {message && (
        <p className={message.kind === 'error' ? 'banner banner-error' : 'banner banner-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="fields">
        <label className="field">
          <span className="label">Título</span>
          <input value={form.title} onChange={(event) => handleTitleChange(event.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span className="label">Slug (URL)</span>
          <input
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              update('slug', event.target.value);
            }}
            maxLength={120}
            placeholder="se genera del título"
          />
        </label>
        <label className="field">
          <span className="label">Resumen (para listados y SEO)</span>
          <textarea value={form.summary} onChange={(event) => update('summary', event.target.value)} rows={2} maxLength={400} />
        </label>
        <label className="field">
          <span className="label">Etiquetas (separadas por coma)</span>
          <input value={form.tags} onChange={(event) => update('tags', event.target.value)} />
        </label>
      </div>

      <ImageField
        legend="Portada"
        url={form.coverUrl}
        alt={form.coverAlt}
        onUrlChange={(coverUrl) => {
          setCoverError(null);
          update('coverUrl', coverUrl);
        }}
        onAltChange={(coverAlt) => update('coverAlt', coverAlt)}
        onUpload={api.uploadImage}
        error={coverError ?? undefined}
        help={
          <>
            Opcional. Se muestra en la home, en los listados y arriba del artículo. Si no cargás una portada, el sitio
            usa la primera imagen del texto; si el texto no tiene ninguna imagen, genera una portada abstracta (siempre la
            misma para este post).
          </>
        }
      />

      <MarkdownEditor value={form.body} onChange={(body) => update('body', body)} onUploadImage={api.uploadImage} />

      {post && (
        <div className="danger-zone">
          <button type="button" className="danger" disabled={busy} onClick={() => void handleDelete()}>
            Eliminar post
          </button>
        </div>
      )}
    </section>
  );
}
