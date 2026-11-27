import type { Post, PostInput } from '../api/types.ts';

/* The post editor form: the post's content as editable text fields, and those fields back as what gets saved. */

export interface PostForm {
  title: string;
  slug: string;
  summary: string;
  /** Comma-separated in the UI. */
  tags: string;
  body: string;
  coverUrl: string;
  coverAlt: string;
}

export const EMPTY_POST_FORM: PostForm = { title: '', slug: '', summary: '', tags: '', body: '', coverUrl: '', coverAlt: '' };

export const toPostForm = (post: Post): PostForm => ({
  title: post.title,
  slug: post.slug,
  summary: post.summary,
  tags: post.tags.join(', '),
  body: post.body,
  coverUrl: post.coverUrl ?? '',
  coverAlt: post.coverAlt ?? '',
});

/**
 * What saving sends. `cover` is the cover already validated and normalized by `validateCover` (empty = null); without
 * it the cover fields go as typed (the history comparison normalizes them itself).
 */
export const toPostInput = (
  form: PostForm,
  cover: Pick<PostInput, 'coverUrl' | 'coverAlt'> = { coverUrl: form.coverUrl, coverAlt: form.coverAlt },
): PostInput => ({
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
