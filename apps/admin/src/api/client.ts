import { messageFromProblem } from './problem.ts';
import type {
  HeroImage,
  HeroImageInput,
  HeroMediaRef,
  MediaAsset,
  Post,
  PostInput,
  PostSummary,
  SiteSettings,
  VideoAsset,
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
 * Header que la API exige en toda petición que modifica datos (defensa CSRF):
 * un formulario o <img> de otro sitio no puede agregar headers personalizados.
 */
const CSRF_HEADERS = { 'X-Requested-With': 'blog-admin' };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { ...CSRF_HEADERS };
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
      // ASP.NET devuelve ProblemDetails: { title, detail, errors? }
      problem = await response.json();
    } catch {
      /* respuesta sin JSON: nos quedamos con statusText */
    }
    throw new ApiError(response.status, messageFromProblem(problem, fallback));
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Sube una imagen; la API la optimiza (AVIF/WebP en varios anchos) y devuelve el asset con sus variantes. */
function uploadMedia(file: File): Promise<MediaAsset> {
  return request<MediaAsset>('POST', '/admin/media', fileForm(file));
}

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const api = {
  /** 200 si hay sesión, ApiError(401) si no. */
  me: () => request<{ authenticated: true }>('GET', '/auth/me'),
  login: (password: string) => request<void>('POST', '/auth/login', { password }),
  logout: () => request<void>('POST', '/auth/logout'),

  listPosts: () => request<PostSummary[]>('GET', '/admin/posts'),
  getPost: (id: string) => request<Post>('GET', `/admin/posts/${encodeURIComponent(id)}`),
  createPost: (input: PostInput) => request<Post>('POST', '/admin/posts', input),
  updatePost: (id: string, input: PostInput) => request<Post>('PUT', `/admin/posts/${encodeURIComponent(id)}`, input),
  publishPost: (id: string) => request<Post>('POST', `/admin/posts/${encodeURIComponent(id)}/publish`),
  unpublishPost: (id: string) => request<Post>('POST', `/admin/posts/${encodeURIComponent(id)}/unpublish`),
  deletePost: (id: string) => request<void>('DELETE', `/admin/posts/${encodeURIComponent(id)}`),

  getSettings: () => request<SiteSettings>('GET', '/admin/settings'),
  /** Guarda los ajustes; la API pide un rebuild del sitio (nombre, bio y links están en todas las páginas). */
  saveSettings: (input: SiteSettings) => request<SiteSettings>('PUT', '/admin/settings', input),

  uploadMedia,
  /** Sube una imagen y devuelve solo su URL pública (/media/...): lo que necesitan el Markdown y la portada. */
  uploadImage: async (file: File): Promise<string> => (await uploadMedia(file)).url,

  /** Sube un video (202): la API lo valida y lo procesa en segundo plano; el estado se consulta con `getVideo`. */
  uploadVideo: (file: File) => request<VideoAsset>('POST', '/admin/media/videos', fileForm(file)),
  getVideo: (id: string) => request<VideoAsset>('GET', `/admin/media/videos/${encodeURIComponent(id)}`),

  // Galería del hero. Cada cambio pide un rebuild del sitio (la galería va embebida en la home).
  listHeroImages: () => request<HeroImage[]>('GET', '/admin/hero-images'),
  createHeroImage: (ref: HeroMediaRef, input: HeroImageInput) =>
    request<HeroImage>('POST', '/admin/hero-images', { ...ref, ...input }),
  updateHeroImage: (id: string, input: HeroImageInput) =>
    request<HeroImage>('PUT', `/admin/hero-images/${encodeURIComponent(id)}`, input),
  deleteHeroImage: (id: string) => request<void>('DELETE', `/admin/hero-images/${encodeURIComponent(id)}`),
};
