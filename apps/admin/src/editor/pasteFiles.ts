import { sanitizeUrl } from '@blog/markdown';
import type { Translate } from '../i18n/i18n.ts';
import { codeLanguageOf, isTextType, MAX_CODE_FILE_BYTES } from './codeFiles.ts';
import { imageMarkdown } from './commands.ts';

/*
 * What a paste or a drop into the editor does, decided from the DataTransfer alone (pure: no React, no DOM, so the
 * tests build plain objects). The editor hook (useImageUpload) carries the plan out:
 *
 *   files          → images are uploaded (the server converts them to AVIF/WebP), text/code files become fenced
 *                    blocks (codeFiles.ts), anything else gets a message. Nothing silently disappears.
 *   remoteImages   → an image copied or dragged from a web page without a file: its http(s) address is inserted as
 *                    Markdown. The editor never fetches it.
 *   imageWithoutAddress → the same but its address is unusable (data:, blob:, relative): a message says what to do.
 *   native         → text, rich text, Word/Excel copies: the textarea's paste and the existing HTML conversion.
 */

/** What the plan needs of a File. */
export interface FileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** What the plan needs of a DataTransfer (clipboardData of a paste, dataTransfer of a drop). */
export interface TransferLike<F extends FileLike = FileLike> {
  readonly files: ArrayLike<F>;
  readonly types: readonly string[];
  getData(format: string): string;
}

export type FileKind = 'image' | 'code' | 'other';

export type TransferPlan<F extends FileLike = FileLike> =
  | { readonly kind: 'native' }
  | { readonly kind: 'files'; readonly images: F[]; readonly code: F[]; readonly other: F[] }
  | { readonly kind: 'remoteImages'; readonly markdown: string }
  | { readonly kind: 'imageWithoutAddress' };

export interface TransferOptions {
  readonly source: 'paste' | 'drop';
  /** Ctrl+Shift+V: plain-text paste. Files still count; the HTML does not. */
  readonly plain?: boolean;
}

/**
 * Image extensions for files the browser gives no MIME type (Chrome on Windows types `.heic` as ""). They are all sent
 * to the server, which is the authority: what it cannot decode comes back with a message naming the format.
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'tif', 'tiff', 'svg', 'heic', 'heif', 'bmp', 'ico', 'jxl']);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * Code first, by name (Windows types `.ts` as `video/mp2t`), then images by MIME type or extension, then any other
 * text by MIME type.
 */
export function fileKind(file: FileLike): FileKind {
  if (codeLanguageOf(file.name) !== null) return 'code';
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(file.name))) return 'image';
  if (isTextType(file.type)) return 'code';
  return 'other';
}

const LONE_URL = /^https?:\/\/\S+$/i;

/**
 * Copying text in Word, Excel or PowerPoint also puts a picture of it on the clipboard: when there is real text (not
 * just the address a browser adds when copying an image), the paste is that text, as it always was.
 */
function isTextCopy(transfer: TransferLike): boolean {
  const text = transfer.getData('text/plain').trim();
  return text !== '' && !LONE_URL.test(text);
}

export function planTransfer<F extends FileLike>(transfer: TransferLike<F>, options: TransferOptions): TransferPlan<F> {
  const files = Array.from(transfer.files);
  if (files.length > 0) {
    const kinds = files.map(fileKind);
    if (options.source === 'paste' && kinds.every((kind) => kind === 'image') && isTextCopy(transfer)) return { kind: 'native' };
    const of = (wanted: FileKind): F[] => files.filter((_, index) => kinds[index] === wanted);
    return { kind: 'files', images: of('image'), code: of('code'), other: of('other') };
  }
  if (options.plain) return { kind: 'native' };

  const remote = remoteImagesMarkdown(transfer.getData('text/html'));
  if (!remote) return { kind: 'native' };
  return remote.markdown === '' ? { kind: 'imageWithoutAddress' } : { kind: 'remoteImages', markdown: remote.markdown };
}

/** A drag that carries files: the editor accepts it, so the browser never opens the file in place of the admin. */
export const acceptsFileDrag = (transfer: { readonly types: readonly string[] }): boolean => transfer.types.includes('Files');

const IMG = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });

function attributesOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, name = '', double, single, bare] of source.matchAll(ATTRIBUTE)) {
    attrs[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attrs;
}

/** Without tags, comments and invisible blocks, is there any text left? (`&nbsp;` and whitespace do not count.) */
const hasText = (html: string): boolean =>
  html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|head|title|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;|\s/gi, '') !== '';

/**
 * HTML made only of images (what a browser puts on the clipboard for a copied image, around comments and wrappers):
 * each image with an http(s) address as `![alt](url)`, one paragraph each. The address goes through the renderer's
 * `sanitizeUrl` and must be absolute http(s): data:, blob:, relative or other schemes are counted as `unusable`.
 * Null when the HTML has text or no image: the existing HTML → Markdown conversion handles it.
 */
export function remoteImagesMarkdown(html: string): { markdown: string; unusable: number } | null {
  if (html === '' || hasText(html)) return null;
  const images = Array.from(html.matchAll(IMG), (match) => attributesOf(match[1] ?? ''));
  if (images.length === 0) return null;

  const usable: string[] = [];
  for (const { src = '', alt = '' } of images) {
    const url = sanitizeUrl(src);
    if (url && /^https?:\/\//i.test(url)) usable.push(imageMarkdown(url, alt.replace(/\s+/g, ' ')));
  }
  return { markdown: usable.join('\n\n'), unusable: images.length - usable.length };
}

/** Something the editor could not insert, told in the UI language. */
export type TransferProblem =
  | { readonly kind: 'unsupported' | 'binary' | 'tooLarge'; readonly name: string }
  | { readonly kind: 'cannotUpload' | 'imageWithoutAddress' };

export function problemMessage(problem: TransferProblem, t: Translate): string {
  switch (problem.kind) {
    case 'unsupported':
      return t('paste.unsupportedFile', { name: problem.name });
    case 'binary':
      return t('paste.binaryFile', { name: problem.name });
    case 'tooLarge':
      return t('paste.codeTooLarge', { name: problem.name, max: MAX_CODE_FILE_BYTES / 1024 });
    case 'cannotUpload':
      return t('paste.cannotUpload');
    case 'imageWithoutAddress':
      return t('paste.imageWithoutAddress');
  }
}
