/**
 * Media guard: an image or video that fails to load (missing file, dropped network, unsupported format) must never
 * look broken: no broken-image icon, no stray alternative text, no stretched blurry placeholder. Its container is
 * hidden and the page's dark background remains.
 *
 * - Container = the ancestor marked with `data-media` (in the hero: photo, poster, video and its Play/Pause button
 *   together, so no control of a broken video is left behind), else the <picture>, else the element itself. Hiding
 *   the container also takes the placeholder with it (it is its background).
 * - A <video> only fails when ALL its <source>s fail: the browser tries the next one (AV1 → H.264) and only the last
 *   one fires the final error. The <source>s of a <picture> fire no errors (the <img> does).
 * - Load errors do not bubble: the listener is in the capture phase on the window, in the <head>, so it also sees
 *   the media that the hero script inserts later.
 * - `style.display` and not the `hidden` attribute: the site CSS sets `display: contents` on some <picture>s, and
 *   that would win over `[hidden]`.
 */

/** Attribute marking the container that is hidden whole when any of its media fails. */
export const MEDIA_CONTAINER_ATTRIBUTE = 'data-media';

/** The exact content of the <head> inline <script> (a constant: its CSP hash does not change between builds). */
export const MEDIA_GUARD_SCRIPT =
  'addEventListener("error",e=>{let t=e.target,n=t.tagName;' +
  // A <video>'s <source>: only the last one counts (no alternatives left). A <picture>'s is ignored.
  'if(n=="SOURCE"){t=t.parentNode;if(t.tagName!="VIDEO"||e.target!=t.lastElementChild)return}' +
  'else if(n!="IMG"&&n!="VIDEO")return;' +
  `(t.closest("[${MEDIA_CONTAINER_ATTRIBUTE}]")||t.closest("picture")||t).style.display="none"},true)`;
