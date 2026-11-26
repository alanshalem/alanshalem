import { slugify } from '@blog/markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Post, PostInput } from '../api/types.ts';
import { ImageField } from '../components/ImageField.tsx';
import { MarkdownEditor, type EditorHandle } from '../editor/MarkdownEditor.tsx';
import { OutlinePanel } from '../editor/OutlinePanel.tsx';
import { documentStats, outlineEntries } from '../editor/preview.ts';
import { usePostPreview } from '../editor/usePostPreview.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { DEFAULT_LANG, LANGS, type Lang } from '../languages.ts';
import { canAutosave, saveStatusText, type SaveState } from '../posts/autosave.ts';
import { lintPost, type LintTarget } from '../posts/lint.ts';
import { PostVersions } from '../posts/PostVersions.tsx';
import { ReviewPanel } from '../posts/ReviewPanel.tsx';
import { SharePanel } from '../posts/SharePanel.tsx';
import { useAutosave } from '../posts/useAutosave.ts';
import { useOtherVersion } from '../posts/useOtherVersion.ts';
import { statusLabel } from '../posts/versions.ts';
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
  const i18n = useUiLanguage();
  const { t } = i18n;
  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saved, setSaved] = useState<string>(JSON.stringify(EMPTY_FORM)); // para detectar cambios sin guardar
  const [slugTouched, setSlugTouched] = useState(false);
  // Solo se elige al crear; después el idioma es el del post (L4).
  const [newLang, setNewLang] = useState<Lang>(DEFAULT_LANG);
  const [loading, setLoading] = useState(postId !== null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const editorRef = useRef<EditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  // Lo último que se escribió, para saber al volver un guardado si hubo cambios mientras viajaba el pedido.
  const formRef = useRef(form);
  formRef.current = form;
  // Un solo guardado a la vez (automático, botón o Ctrl+S): `busy` llega tarde para un Ctrl+S repetido.
  const savingRef = useRef(false);

  const snapshot = JSON.stringify(form);
  const dirty = snapshot !== saved;
  const lang = post?.lang ?? newLang;
  const isPublished = post?.status === 'published';
  const other = useOtherVersion(post?.translations[0]?.id ?? null, onError);
  const preview = usePostPreview(form.body, lang);
  const original = usePostPreview(other?.body ?? '', other?.lang ?? lang);
  const stats = useMemo(() => documentStats(preview.markdown), [preview.markdown]);
  const outline = useMemo(() => outlineEntries(preview.markdown, preview.headings), [preview]);
  const issues = useMemo(
    () => lintPost({ title: form.title, summary: form.summary, body: preview.markdown }),
    [form.title, form.summary, preview.markdown],
  );
  const { title, summary, slug, coverUrl, coverAlt } = form;
  const shareInput = useMemo(
    () => ({ title, summary, slug, coverUrl, coverAlt, lang, body: preview.markdown, html: preview.html }),
    [title, summary, slug, coverUrl, coverAlt, lang, preview],
  );

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
        if (!onError(caught)) setMessage({ kind: 'error', text: t('post.loadError') });
      })
      .finally(() => setLoading(false));
    // Sin `t`: cambiar el idioma de la interfaz no vuelve a cargar el post (pisaría lo que se está editando).
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

  /**
   * Guarda (crea o actualiza) y devuelve el post resultante, o null si falló o ya había otro guardado en curso.
   * `auto` (el guardado automático): sin aviso de "Guardado." y sin reemplazar el formulario por lo que normaliza la
   * API (recortar un espacio final del título mientras se escribe se comería ese espacio).
   */
  const save = useCallback(async ({ auto = false }: { auto?: boolean } = {}): Promise<Post | null> => {
    if (savingRef.current) return null;
    const fail = (text: string): null => {
      setMessage({ kind: 'error', text });
      setSaveState({ kind: 'error' });
      return null;
    };
    if (form.title.trim() === '') return fail(t('post.titleRequired'));
    const cover = validateCover(form.coverUrl, form.coverAlt, i18n);
    if (!cover.ok) {
      setCoverError(cover.error);
      return fail(cover.error);
    }
    setCoverError(null);
    savingRef.current = true;
    setBusy(true);
    setSaveState({ kind: 'saving' });
    setMessage(null);
    try {
      const input = toInput(form, { coverUrl: cover.coverUrl, coverAlt: cover.coverAlt });
      const result = post ? await api.updatePost(post.id, input) : await api.createPost(input, newLang);
      const resultForm = toForm(result);
      // Lo escrito mientras viajaba el pedido no se pisa: queda como cambio sin guardar.
      const keepForm = auto || formRef.current !== form;
      setPost(result);
      if (!keepForm) setForm(resultForm);
      setSaved(JSON.stringify(keepForm ? form : resultForm));
      setSaveState({ kind: 'saved', at: new Date() });
      // El post nuevo pasa a tener su propia URL. replaceState (y no navigate) para no disparar
      // hashchange: remontaría la página en medio de un "Publicar" y perdería el mensaje de resultado.
      if (!post) window.history.replaceState(null, '', href.post(result.id));
      if (!auto) setMessage({ kind: 'ok', text: t('post.saved') });
      return result;
    } catch (caught) {
      if (onError(caught)) return null;
      return fail(caught instanceof Error ? caught.message : t('post.saveError'));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }, [form, post, newLang, onError, i18n, t]);

  useAutosave(
    canAutosave({ exists: post !== null, published: isPublished, title: form.title, dirty, saving: busy }),
    snapshot,
    () => void save({ auto: true }),
  );

  /** "Ir a" de un aviso del revisor: la línea en el editor o el campo. */
  const goTo = (target: LintTarget): void => {
    if ('line' in target) editorRef.current?.goToLine(target.line);
    else (target.field === 'title' ? titleRef : summaryRef).current?.focus();
  };

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
      setMessage({ kind: 'ok', text: t('post.publishedNote') });
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: t('post.publishError') });
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    if (!post) return;
    setBusy(true);
    try {
      setPost(await api.unpublishPost(post.id));
      setMessage({ kind: 'ok', text: t('post.unpublishedNote') });
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: t('post.unpublishError') });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!post || !window.confirm(t('post.confirmDelete', { title: post.title }))) return;
    setBusy(true);
    try {
      await api.deletePost(post.id);
      setSaved(JSON.stringify(form)); // evita el aviso de cambios sin guardar al salir
      navigate(href.posts);
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: t('post.deleteError') });
      setBusy(false);
    }
  };

  if (loading) return <p>{t('common.loading')}</p>;

  return (
    <section className="post-editor">
      <div className="page-head page-head-sticky">
        <div>
          <a className="back-link" href={href.posts}>
            ← {t('nav.posts')}
          </a>
          <h1 className="page-title">{post ? post.title || t('common.untitled') : t('post.new')}</h1>
        </div>
        <div className="actions">
          <span className="meta" role="status">
            {saveStatusText({ state: saveState, dirty, exists: post !== null, published: isPublished }, i18n)}
          </span>
          {post && (
            <span className={`chip chip-${post.status}`}>{statusLabel(post.status, i18n)}</span>
          )}
          <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {t('common.save')}
          </button>
          {isPublished ? (
            <button type="button" disabled={busy} onClick={() => void handleUnpublish()}>
              {t('post.unpublish')}
            </button>
          ) : null}
          <button type="button" className="primary" disabled={busy} onClick={() => void handlePublish()}>
            {isPublished ? t('post.republish') : t('post.publish')}
          </button>
        </div>
      </div>

      {message && (
        <p className={message.kind === 'error' ? 'banner banner-error' : 'banner banner-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {post ? (
        <PostVersions post={post} draft={form} dirty={dirty} other={other} onError={onError} />
      ) : (
        <div className="post-versions">
          <label className="field post-lang-select">
            <span className="label">{t('post.language')}</span>
            <select value={newLang} onChange={(event) => setNewLang(event.target.value as Lang)}>
              {LANGS.map((lang) => (
                <option key={lang} value={lang}>
                  {t(`lang.label.${lang}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="fields">
        <label className="field">
          <span className="label">{t('post.title')}</span>
          <input ref={titleRef} value={form.title} onChange={(event) => handleTitleChange(event.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span className="label">{t('post.slug')}</span>
          <input
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              update('slug', event.target.value);
            }}
            maxLength={120}
            placeholder={t('post.slugPlaceholder')}
          />
        </label>
        <label className="field">
          <span className="label">{t('post.summary')}</span>
          <textarea ref={summaryRef} value={form.summary} onChange={(event) => update('summary', event.target.value)} rows={2} maxLength={400} />
        </label>
        <label className="field">
          <span className="label">{t('post.tags')}</span>
          <input value={form.tags} onChange={(event) => update('tags', event.target.value)} />
        </label>
      </div>

      <ImageField
        legend={t('post.cover')}
        url={form.coverUrl}
        alt={form.coverAlt}
        onUrlChange={(coverUrl) => {
          setCoverError(null);
          update('coverUrl', coverUrl);
        }}
        onAltChange={(coverAlt) => update('coverAlt', coverAlt)}
        onUpload={api.uploadImage}
        error={coverError ?? undefined}
        help={t('post.coverHelp')}
      />

      <MarkdownEditor
        ref={editorRef}
        value={form.body}
        onChange={(body) => update('body', body)}
        lang={lang}
        onUploadImage={api.uploadImage}
        previewHtml={preview.html}
        original={other ? { html: original.html, lang: other.lang } : null}
        stats={stats}
      />

      <div className="post-tools">
        <OutlinePanel entries={outline} onSelect={(entry) => editorRef.current?.goToHeading(entry)} />
        <ReviewPanel issues={issues} onSelect={goTo} />
        <SharePanel input={shareInput} />
      </div>

      {post && (
        <div className="danger-zone">
          <button type="button" className="danger" disabled={busy} onClick={() => void handleDelete()}>
            {t('post.delete')}
          </button>
        </div>
      )}
    </section>
  );
}
