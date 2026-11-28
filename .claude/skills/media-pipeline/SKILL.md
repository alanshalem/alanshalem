---
name: media-pipeline
description: "How this blog handles uploaded images and hero videos end to end, covering magic-byte validation and the accepted formats (SVG rasterized only), pasting or dropping images and code files into the editor, the NetVips pipeline (AVIF + WebP widths, no metadata, placeholder, dedupe by hash), the ffmpeg pipeline (trim, fades, no audio, AV1 + H.264 at 720p/1080p, poster, background queue), storage under /media, the hero size rule, responsive rendering on the site, reduced motion and the never-broken media guard. Use when changing uploads, formats, paste/drop in the editor, processing, storage paths, DTOs, Caddy /media rules, or how images and videos render."
---

# Media pipeline (images and videos)

The DTOs below are the contracts between the API (`Blog.Application/Media`, `Blog.Application/Videos`), the admin
(`api/types.ts`) and the site (`lib/media.ts`, `lib/hero.ts`). Change all three together.

## Images (every upload: hero, covers, post images)

- Validate before decoding: ≤ 8 MB (`MediaService.MaxBytes`), magic bytes PNG/JPG/GIF/WebP/AVIF/TIFF/SVG
  (`Blog.Application/Media/ImageSniffer.cs`), header-only size read, ≤ 100 MP (`MaxPixels`).
- **SVG is only rasterized**: librsvg (inside the bundled libvips) renders it to the usual AVIF/WebP; the SVG itself is
  never stored or served, so its scripts never reach a browser. Loading from a buffer has no base URL, so external
  `href`s (files, metadata endpoints) are not loaded (tested); an SVG declaring `<!ENTITY` or an internal DTD subset
  is not even recognized. Rendered at its intrinsic size (no upscaling, like any image).
- What decodes is what the bundled libvips (`NetVips.Native.linux-x64`, same bytes in the API image) has a loader for,
  probed in the image (2026-11, libvips 8.18.7): png, jpeg, gif, webp, heif (AV1 only), tiff, svg. **Not available**:
  HEVC (HEIC/iPhone photos: "Support for this compression format has not been built in: HEVC"), JPEG XL, BMP, ICO
  (no magick). `ImageSniffer.UndecodableFormatName` recognizes those and the upload answers
  `media.formatNotDecodable` naming the format ("Convertila a PNG o JPG"), not "damaged file".
  `NetVipsImageProcessor` also implements `IImageFormatSupport.CanDecode` (is the loader there?): a libvips without
  `svgload` answers the same named message. A test pins that every accepted format has its loader.
- Pages: only GIF, WebP and HEIF pages are animation frames; a multi-page TIFF uses its first page as a still image.
- `NetVipsImageProcessor` (singleton semaphore: one image at a time): shrink-on-load, auto-rotate by EXIF, strip all
  metadata, convert to sRGB, encode AVIF + WebP at widths `[640, 1024, 1600, 2400]` that are ≤ the original
  (at least one), dominant color `#rrggbb`, WebP placeholder data URI ≤ 400 bytes (`MediaAsset.MaxPlaceholderLength`).
- Files: `/media/{hash}/{width}.{avif|webp}`, hash of the original content. Same content = same asset (dedupe),
  but verify the files exist before reusing.
- `MediaAssetDto`: `{ id, url (WebP of largest width ≤ 1600), width, height, color, placeholder, variants: [{ format,
  width, url }], createdAt }`. `GET /api/internal/media` lists all assets so the site can build `srcset` for any
  `/media/...` URL.

## Pasting and dropping into the editor (admin)

- `apps/admin/src/editor/pasteFiles.ts` (pure) decides from the DataTransfer: **files** (images by MIME type or
  extension, `.heic` comes without a type on Windows; code by extension first, `.ts` is `video/mp2t` there; other
  text by MIME) / **remoteImages** (HTML made only of `<img>`: each http(s) `src` through `sanitizeUrl` as
  `![alt](url)`, never fetched) / **imageWithoutAddress** (data:, blob:, relative: a message) / **native** (text, rich
  text, and Word/Excel copies, which also carry a picture of the text: real `text/plain` wins over the image).
- Images go through the same upload as the toolbar (`useImageUpload`); the server is the authority on formats and
  its localized message is shown. Code files: `codeFiles.ts` (one extension map, names of `@blog/highlight`),
  ≤ 256 KB, NUL byte or invalid UTF-8 = binary, fence longer than any backtick run inside, a file-name caption line
  per block when several. Nothing is uploaded. Every refusal is said in the status line (`paste.*` keys).
- The textarea accepts a drag that carries files (`acceptsDrag` on `dragover`) so the browser never opens the file
  instead of the admin.

## Videos (hero only)

- Upload `POST /api/admin/media/videos` (multipart, ≤ 200 MB): magic bytes MP4/MOV/WebM/MKV + ffprobe; trimmed length
  1–15 s; fields `trimStart`, `trimEnd` (default `min(duration, trimStart + 15)`), `fade` `loop|black|none` (default
  `loop`), `fadeSeconds` `0.5|1|2` (default 1, and `2 × fadeSeconds ≤` trimmed length). Answers **202** with
  `VideoAssetDto` `status: "processing"`; poll `GET /api/admin/media/videos/{id}`.
- The original is staged in `Video:WorkDirectory` (default `data/video-work`, never inside `Media:Directory`): it has
  audio and metadata and must never be served.
- `VideoProcessingWorker` takes one job at a time from an in-memory queue; `FfmpegVideoTranscoder` runs ffmpeg with
  low priority and bounded threads: exact trim, fades, `-an`, `hqdn3d` + `unsharp` (soft), ≤ 30 fps, 1080p and 720p
  never upscaled, AV1 (libsvtav1) + H.264 (libx264 high, yuv420p) MP4 with `+faststart`. Poster = first visible frame
  (after a fade-in from black) through the image pipeline.
- Files: `/media/videos/{hash}/{height}.{codec}.mp4`. Failure → `status: "failed"` with an error, no partial files.
- Dedupe by file hash **plus** the normalized edit (same file, other trim = other asset).

## Hero rule (photos and videos, domain `HeroFrame`)

- Rejected if not landscape (width < 6/5 × height, integer comparison) or smaller than 1280×720; accepted with a
  warning under 1920×1080. Guide text: "Ideal: 1920×1080 o más, horizontal 16:9". Covers and post images have no rule.
- The admin pre-checks with the same numbers from `apps/admin/src/limits.ts` (`heroFrame`, `video`). Size warnings in
  the admin always come from its own rule (`checkHeroSize` in `hero/heroSize.ts`), in the UI language; for an uploaded
  video it is applied to the size the API measured (`videoWarnings` in `hero/heroVideo.ts`).

## Rendering on the site

- Images only through `ResponsiveImage.astro` → `imageHtml` (`apps/web/src/lib/responsive-image.ts`): `<picture>`
  with AVIF then WebP `srcset`/`sizes` for known assets, dominant color/placeholder as background, plain `<img>` for
  external URLs.
- Hero: gallery JSON embedded with `jsonForScript`; first item in `<noscript>` and `og:image`; the inline rotation
  script picks a random item different from the last one (`localStorage`).
- Video: `<video autoplay muted loop playsinline preload="metadata" poster>` with AV1 sources before H.264 and 1080p
  only for wide screens; `prefers-reduced-motion: reduce` or Save-Data → poster + ▶ Reproducir; otherwise ❚❚ Pausar
  (WCAG 2.2.2).
- Media guard (`lib/media-guard.ts`): a failed `<img>`, or a `<video>` whose last `<source>` failed, hides its
  `[data-media]` container → black background, never a broken icon or stretched placeholder.

## Serving

- Caddy `/media/*`: `Cache-Control: public, max-age=31536000, immutable` (names come from hashes), restrictive CSP
  with `sandbox`, **no `encode`** (already compressed, and Range needs exact bytes). Errors are `no-store`.
- Development: the API serves `/media` from `Media:Directory` only in Development; Vite and `astro dev` proxy `/media`
  to it.
- Resources: encoding a 15 s 1080p video takes ~3.5 min and peaks ~1.3 GiB; the API container has `mem_limit 1536m`,
  `cpus 2.0` (the owner's decision).

## Checklist

- [ ] Validation (size, magic bytes, dimensions/duration) happens before any heavy work and changes nothing on reject.
- [ ] Nothing user-provided builds a path: paths come from hashes (`MediaAsset.RelativePathOf`).
- [ ] New outputs are deterministic, immutable-cacheable and never overwrite a different content.
- [ ] Site rendering has a fallback and a `data-media` container.
- [ ] Real-ffmpeg tests (`[Trait("Category", "Ffmpeg")]`) pass locally when the transcoder changes.

## Anti-patterns seen here

- Animated GIF/WebP silently losing animation; placeholder without a size cap (→ 500).
- Pasted/dropped files without an `image/*` type (HEIC on Windows) and every non-image file silently ignored by the
  editor, and HEIC accepted by the header read then failing as "damaged": now named in a message.
- Marking a video Ready without checking its files; `MarkFailed` after `MarkReady` masking the real error.
- Poster taken from a frame after `TrimEnd` (review R3-004).
- `/media` 404s cached as immutable for a year (fixed with `no-store` in `handle_errors`).
- A comment saying "≈1 minute" for an encode measured at 211 s: measure, then write the number.
