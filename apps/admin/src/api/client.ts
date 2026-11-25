import { messageFromProblem } from './problem.ts';
import type { Post, PostInput, PostSummary, SiteSettings } from './types.ts';

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

  /** Sube una imagen y devuelve la URL pública (relativa, /media/...): para el Markdown, la portada o el hero. */
  async uploadImage(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const { url } = await request<{ url: string }>('POST', '/admin/media', form);
    return url;
  },
};
