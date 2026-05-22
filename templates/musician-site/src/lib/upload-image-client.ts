import {
  ALLOWED_INPUT_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AllowedInputMimeType,
  type FocalPoint,
  type ImageMetadata,
  uploadResponseSchema,
} from "./image-types";

/**
 * Single bucket for editor-uploaded images. The `contentSlug` slot in
 * `public/images/<slug>/<id>/...` is for namespacing across content types
 * later (e.g. /releases vs /tour); for ad-hoc Puck-block image uploads,
 * everything just goes to "uploads".
 */
export const EDITOR_UPLOAD_SLUG = "uploads";

export type UploadImageError = {
  /** Stable error code so the UI can branch without parsing strings. */
  code: "invalid-mime" | "too-large" | "empty" | "request-failed" | "server-error";
  message: string;
};

/**
 * Client-side upload helper: validates locally, POSTs to /api/upload-image,
 * returns the parsed ImageMetadata. Used by the Puck custom image field.
 *
 * Validation runs client-side too (not just server-side) so the UI can
 * give immediate feedback before the network call. The server still
 * validates — these are not the source of truth.
 */
export async function uploadImageFromClient(args: {
  file: File;
  alt: string;
  contentSlug?: string;
  /** Optional editorial metadata persisted alongside the image. */
  caption?: string;
  credit?: string;
  focalPoint?: FocalPoint;
  /** Defaults to global fetch; injectable for tests. */
  fetchImpl?: typeof fetch;
}): Promise<ImageMetadata> {
  const { file, alt, caption, credit, focalPoint } = args;
  const contentSlug = args.contentSlug ?? EDITOR_UPLOAD_SLUG;
  const fetchImpl = args.fetchImpl ?? fetch;

  if (file.size === 0) {
    throw { code: "empty", message: "File is empty" } satisfies UploadImageError;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw {
      code: "too-large",
      message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
    } satisfies UploadImageError;
  }
  if (!ALLOWED_INPUT_MIME_TYPES.includes(file.type as AllowedInputMimeType)) {
    throw {
      code: "invalid-mime",
      message: `Unsupported file type: ${file.type || "unknown"}. Allowed: ${ALLOWED_INPUT_MIME_TYPES.join(", ")}`,
    } satisfies UploadImageError;
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("contentSlug", contentSlug);
  fd.append("alt", alt);
  if (caption !== undefined && caption !== "") fd.append("caption", caption);
  if (credit !== undefined && credit !== "") fd.append("credit", credit);
  if (focalPoint !== undefined) fd.append("focalPoint", JSON.stringify(focalPoint));

  let res: Response;
  try {
    res = await fetchImpl("/api/upload-image", { method: "POST", body: fd });
  } catch (cause) {
    throw {
      code: "request-failed",
      message: `Network error: ${String(cause)}`,
    } satisfies UploadImageError;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw {
      code: "server-error",
      message: `Server returned non-JSON ${res.status}`,
    } satisfies UploadImageError;
  }

  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error)
        : `Server returned ${res.status}`;
    throw { code: "server-error", message } satisfies UploadImageError;
  }

  const parsed = uploadResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw {
      code: "server-error",
      message: `Upload response was malformed: ${parsed.error.message}`,
    } satisfies UploadImageError;
  }
  return parsed.data.image;
}
