import { slugify } from '@blog/markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Post, PostInput } from '../api/types.ts';
import { Banner, type Notice } from '../components/Banner.tsx';
import { ImageField } from '../components/ImageField.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { MarkdownEditor, type EditorHandle } from '../editor/MarkdownEditor.tsx';
import { OutlinePanel } from '../editor/OutlinePanel.tsx';
import { documentStats, outlineEntries } from '../editor/preview.ts';
import { usePostPreview } from '../editor/usePostPreview.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { LIMITS } from '../limits.ts';
import { DEFAULT_LANG, LANGS, type Lang } from '../languages.ts';
import { pageTitle } from '../navigation/pageTitle.ts';
import { useUnsavedGuard } from '../navigation/useUnsavedGuard.ts';
import { canAutosave, saveStatusText, type SaveState } from '../posts/autosave.ts';
import { HistoryPanel } from '../posts/HistoryPanel.tsx';
import { lintPost, type LintTarget } from '../posts/lint.ts';
import { PostVersions } from '../posts/PostVersions.tsx';
import { ReviewPanel } from '../posts/ReviewPanel.tsx';
import { SchedulePanel } from '../posts/SchedulePanel.tsx';
import { SharePanel } from '../posts/SharePanel.tsx';
import { useAutosave } from '../posts/useAutosave.ts';
import { useOtherVersion } from '../posts/useOtherVersion.ts';
import { statusLabel } from '../posts/versions.ts';
import { validateCover } from '../settings/validate.ts';
import { href, navigate } from '../useRoute.ts'; // navigate: solo al eliminar
import { useSaveShortcut } from '../useSaveShortcut.ts';

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
  const [message, setMessage] = useState<Notice | null>(null);
  // Título vacío al guardar: el campo queda marcado (aria-invalid + el error asociado) y recibe el foco (P2-7).
  const [titleError, setTitleError] = useState<string | null>(null);
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
  const stats = useMemo(() => documentStats(preview.text), [preview.text]);
  const outline = useMemo(() => outlineEntries(preview.markdown, preview), [preview]);
  const issues = useMemo(
    () => lintPost({ title: form.title, summary: form.summary, body: preview.markdown }),
    [form.title, form.summary, preview.markdown],
  );
  const { title, summary, slug, coverUrl, coverAlt } = form;
  const shareInput = useMemo(
    () => ({ title, summary, slug, coverUrl, coverAlt, lang, body: preview.markdown, html: preview.html }),
    [title, summary, slug, coverUrl, coverAlt, lang, preview],
  );
  // El historial compara contra lo que se guardaría ahora (la normalización de la portada la hace la comparación).
  const current = useMemo(() => toInput(form, { coverUrl: form.coverUrl, coverAlt: form.coverAlt }), [form]);

  /** El post como lo devuelve la API, en el editor: al cargarlo y al restaurar una versión. */
  const showPost = (loaded: Post): void => {
    const loadedForm = toForm(loaded);
    setPost(loaded);
    setForm(loadedForm);
    setSaved(JSON.stringify(loadedForm));
    setSlugTouched(true); // un post existente conserva su slug aunque cambie el título
  };

  useEffect(() => {
    if (postId === null) return;
    api
      .getPost(postId)
      .then(showPost)
      .catch((caught: unknown) => {
        if (!onError(caught)) setMessage({ kind: 'error', text: t('post.loadError') });
      })
      .finally(() => setLoading(false));
    // Sin `t`: cambiar el idioma de la interfaz no vuelve a cargar el post (pisaría lo que se está editando).
  }, [postId, onError]);

  // Avisa antes de perder cambios: otra vista, Salir, crear otra versión o cerrar la pestaña. El guardado automático
  // actualiza `saved`, así que un borrador que ya se guardó solo no pregunta.
  useUnsavedGuard(dirty);

  const update = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((current) => ({ ...current, [key]: value }));

  const handleTitleChange = (title: string): void => {
    setTitleError(null);
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
    if (form.title.trim() === '') {
      setTitleError(t('post.titleRequired'));
      titleRef.current?.focus();
      return fail(t('post.titleRequired'));
    }
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

  useSaveShortcut(save);

  /**
   * Restaurar, programar y cancelar cambian el post fuera del formulario: de a una y sin un guardado (tampoco el
   * automático) en medio, que podría pisar lo restaurado o devolver una programación vieja. Los errores se lanzan:
   * los muestra el panel que la pidió, junto al botón.
   */
  const runExclusive = async (action: () => Promise<Post>): Promise<Post | null> => {
    if (savingRef.current) return null;
    savingRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const handleRestore = async (revisionId: string): Promise<Post | null> => {
    if (!post) return null;
    const restored = await runExclusive(() => api.restoreRevision(post.id, revisionId));
    if (restored) {
      showPost(restored);
      setTitleError(null);
      setCoverError(null);
      setSaveState({ kind: 'saved', at: new Date() });
    }
    return restored;
  };

  /** Como "Publicar": lo pendiente se guarda antes, así se publica lo que se ve. */
  const handleSchedule = async (publishAt: string): Promise<Post | null> => {
    const latest = dirty ? await save() : post;
    if (!latest) return null;
    const scheduled = await runExclusive(() => api.schedulePost(latest.id, publishAt));
    if (scheduled) setPost(scheduled);
    return scheduled;
  };

  const handleUnschedule = async (): Promise<Post | null> => {
    if (!post) return null;
    const unscheduled = await runExclusive(() => api.unschedulePost(post.id));
    if (unscheduled) setPost(unscheduled);
    return unscheduled;
  };

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
      navigate(href.posts, { confirmed: true }); // ya no hay nada que guardar: sin aviso de cambios
    } catch (caught) {
      if (!onError(caught)) setMessage({ kind: 'error', text: t('post.deleteError') });
      setBusy(false);
    }
  };

  if (loading) return <p>{t('common.loading')}</p>;

  return (
    <section className="post-editor">
      <PageHead
        sticky
        heading={post ? post.title || t('common.untitled') : t('post.new')}
        documentTitle={pageTitle(post ? { name: 'edit', title: post.title } : { name: 'new' }, t)}
        above={
          <a className="back-link" href={href.posts}>
            ← {t('nav.posts')}
          </a>
        }
      >
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
      </PageHead>

      <Banner notice={message} />

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

      {post && !isPublished && (
        <div className="post-schedule">
          <SchedulePanel
            post={post}
            busy={busy}
            onSchedule={handleSchedule}
            onUnschedule={handleUnschedule}
            onError={onError}
          />
        </div>
      )}

      <div className="fields">
        <div className="field">
          <label className="label" htmlFor="post-title">
            {t('post.title')}
          </label>
          <input
            id="post-title"
            ref={titleRef}
            value={form.title}
            onChange={(event) => handleTitleChange(event.target.value)}
            maxLength={LIMITS.post.title}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'post-title-error' : undefined}
          />
          {titleError && (
            <p id="post-title-error" className="field-error">
              {titleError}
            </p>
          )}
        </div>
        <label className="field">
          <span className="label">{t('post.slug')}</span>
          <input
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              update('slug', event.target.value);
            }}
            maxLength={LIMITS.post.slug}
            placeholder={t('post.slugPlaceholder')}
          />
        </label>
        <label className="field">
          <span className="label">{t('post.summary')}</span>
          <textarea ref={summaryRef} value={form.summary} onChange={(event) => update('summary', event.target.value)} rows={2} maxLength={LIMITS.post.summary} />
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
        altMaxLength={LIMITS.post.coverAlt}
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
        preview={preview}
        original={other ? { html: original.html, lang: other.lang } : null}
        stats={stats}
      />

      <div className="post-tools">
        <OutlinePanel entries={outline} onSelect={(entry) => editorRef.current?.goToHeading(entry)} />
        <ReviewPanel issues={issues} onSelect={goTo} />
        <SharePanel input={shareInput} />
      </div>

      {post && (
        <div className="post-history">
          <HistoryPanel
            post={post}
            current={current}
            dirty={dirty}
            busy={busy}
            onRestore={handleRestore}
            onError={onError}
          />
        </div>
      )}

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
