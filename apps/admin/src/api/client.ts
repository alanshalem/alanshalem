import { DEFAULT_LANG, type Lang } from '../languages.ts';
import { messageFromProblem } from './problem.ts';
import type {
  HeroImage,
  HeroImageInput,
  HeroMediaRef,
  MediaAsset,
  Post,
  PostInput,
  PostRevision,
  PostRevisionSummary,
  PostSummary,
  SiteSettings,
  VideoAsset,
  VideoEdit,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Header the API requires on every request that changes data (CSRF defense):
 * a form or <img> on another site cannot add custom headers.
 */
const CSRF_HEADERS = { 'X-Requested-With': 'blog-admin' };

/**
 * UI language, so the API answers its errors in that language (Accept-Language) and not in the browser's. The
 * language provider (UiLanguage) updates it every time the ES | EN selector changes.
 */
let apiLanguage: Lang = DEFAULT_LANG;

export function setApiLanguage(lang: Lang): void {
  apiLanguage = lang;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { ...CSRF_HEADERS, 'Accept-Language': apiLanguage };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (!response.ok) {
    const fallback = response.statusText || `Error ${response.status}`;
    let problem: unknown = null;
    try {
      // ASP.NET returns ProblemDetails: { title, detail, errors? }
      problem = await response.json();
    } catch {
      /* response without JSON: keep statusText */
    }
    throw new ApiError(response.status, messageFromProblem(problem, fallback));
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Uploads an image; the API optimizes it (AVIF/WebP in several widths) and returns the asset with its variants. */
function uploadMedia(file: File): Promise<MediaAsset> {
  return request<MediaAsset>('POST', '/admin/media', fileForm(file));
}

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

/** The file and, if chosen, the trim and the fade. Without them the API uses its defaults. */
function videoForm(file: File, edit: VideoEdit | undefined): FormData {
  const form = fileForm(file);
  if (edit) {
    // String(2.5) = "2.5": always a decimal point, regardless of the browser's language.
    form.append('trimStart', String(edit.trimStart));
    form.append('trimEnd', String(edit.trimEnd));
    form.append('fade', edit.fade);
    form.append('fadeSeconds', String(edit.fadeSeconds));
  }
  return form;
}

/** A post's path (with the id encoded): every operation on one post starts here. */
const postPath = (id: string): string => `/admin/posts/${encodeURIComponent(id)}`;

export const api = {
  /** 200 with a session, ApiError(401) without one. */
  me: () => request<{ authenticated: true }>('GET', '/auth/me'),
  login: (password: string) => request<void>('POST', '/auth/login', { password }),
  logout: () => request<void>('POST', '/auth/logout'),

  listPosts: () => request<PostSummary[]>('GET', '/admin/posts'),
  getPost: (id: string) => request<Post>('GET', postPath(id)),
  /** The language is only sent on create: an existing post's language cannot change. */
  createPost: (input: PostInput, lang: Lang) => request<Post>('POST', '/admin/posts', { ...input, lang }),
  updatePost: (id: string, input: PostInput) => request<Post>('PUT', postPath(id), input),
  publishPost: (id: string) => request<Post>('POST', `${postPath(id)}/publish`),
  unpublishPost: (id: string) => request<Post>('POST', `${postPath(id)}/unpublish`),
  deletePost: (id: string) => request<void>('DELETE', postPath(id)),
  /** Creates the draft of the version in another language (201), with the content copied as a starting point. */
  createTranslation: (id: string, lang: Lang) =>
    request<Post>('POST', `${postPath(id)}/translations`, { lang }),

  // History: one revision per save that changes the content; restoring saves that revision as the current one.
  listRevisions: (id: string) => request<PostRevisionSummary[]>('GET', `${postPath(id)}/revisions`),
  getRevision: (id: string, revisionId: string) =>
    request<PostRevision>('GET', `${postPath(id)}/revisions/${encodeURIComponent(revisionId)}`),
  restoreRevision: (id: string, revisionId: string) =>
    request<Post>('POST', `${postPath(id)}/revisions/${encodeURIComponent(revisionId)}/restore`),
  /** Drafts only, in the future; `publishAt` in ISO 8601 with offset (the API rejects a time without a zone). */
  schedulePost: (id: string, publishAt: string) => request<Post>('PUT', `${postPath(id)}/schedule`, { publishAt }),
  unschedulePost: (id: string) => request<Post>('DELETE', `${postPath(id)}/schedule`),

  getSettings: () => request<SiteSettings>('GET', '/admin/settings'),
  /** Saves the settings; the API requests a site rebuild (name, bio and links are on every page). */
  saveSettings: (input: SiteSettings) => request<SiteSettings>('PUT', '/admin/settings', input),

  uploadMedia,
  /** Uploads an image and returns only its public URL (/media/...): what the Markdown and the cover need. */
  uploadImage: async (file: File): Promise<string> => (await uploadMedia(file)).url,

  /**
   * Uploads a video (202) with the chosen trim and fade: the API validates it and processes it in the background;
   * the status is polled with `getVideo`.
   */
  uploadVideo: (file: File, edit?: VideoEdit) => request<VideoAsset>('POST', '/admin/media/videos', videoForm(file, edit)),
  getVideo: (id: string) => request<VideoAsset>('GET', `/admin/media/videos/${encodeURIComponent(id)}`),

  // Hero gallery. Every change requests a site rebuild (the gallery is embedded in the home page).
  listHeroImages: () => request<HeroImage[]>('GET', '/admin/hero-images'),
  createHeroImage: (ref: HeroMediaRef, input: HeroImageInput) =>
    request<HeroImage>('POST', '/admin/hero-images', { ...ref, ...input }),
  updateHeroImage: (id: string, input: HeroImageInput) =>
    request<HeroImage>('PUT', `/admin/hero-images/${encodeURIComponent(id)}`, input),
  deleteHeroImage: (id: string) => request<void>('DELETE', `/admin/hero-images/${encodeURIComponent(id)}`),
};
