/**
 * Pure media-kind inference for the Card block's file preview. When a
 * Card has no image but carries a `fileUrl` (a downloadable asset —
 * press-kit PDF, an audio track, a promo video, a zip), the media
 * slot renders a file-type icon tile instead of staying empty. The
 * kind drives which glyph the tile shows.
 *
 * Ported from the legacy template's `inferMediaKind`, narrowed to the
 * non-image kinds: proper image previews go through the image picker
 * (`ImagePickerField` → `ImageMetadata` → `<Image>`), so an image-
 * extension `fileUrl` falls through to the generic `file` tile rather
 * than a raw `<img>` that would bypass the optimised pipeline.
 *
 * No node / client imports — safe to call from the server-side Puck
 * render path.
 */

export const CARD_MEDIA_KINDS = ["audio", "video", "pdf", "file"] as const;
export type CardMediaKind = (typeof CARD_MEDIA_KINDS)[number];

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v"]);
const PDF_EXTS = new Set(["pdf"]);

/**
 * Infer a Card file preview's media kind from a URL or path. Query
 * strings + fragments are stripped first so a CDN URL like
 * `https://cdn.example.com/track.mp3?v=3` still reads as audio.
 * Anything unrecognised (including image extensions and extensionless
 * URLs) maps to `file` — a generic downloadable tile.
 */
export function inferCardMediaKind(url: string): CardMediaKind {
  const clean = url.split(/[?#]/, 1)[0] ?? url;
  const ext = clean.split(".").pop()?.toLowerCase();
  // `split(".")` on a path with no dot returns the whole string, so
  // guard the no-extension case (ext === the filename) by checking
  // for a dot at all.
  if (!ext || !clean.includes(".")) return "file";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (PDF_EXTS.has(ext)) return "pdf";
  return "file";
}

/**
 * Extract a human-readable filename from a URL or path for the icon
 * tile's caption. Strips query + fragment, takes the last path
 * segment, and percent-decodes (`Press%20Kit.pdf` → `Press Kit.pdf`).
 * Falls back to the raw segment if decoding throws on a malformed
 * escape sequence.
 */
export function cardMediaFilename(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? url;
  const segment = clean.split("/").pop() ?? clean;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
