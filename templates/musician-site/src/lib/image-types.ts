import { z } from "zod";

export const IMAGE_VARIANT_WIDTHS = [400, 800, 1600] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

export const IMAGE_VARIANT_FORMATS = ["webp", "avif"] as const;
export type ImageVariantFormat = (typeof IMAGE_VARIANT_FORMATS)[number];

export const ALLOWED_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  // Vector / icon formats — bypass the sharp variant pipeline. Sharp
  // can rasterise SVG and can't parse ICO at all; either way, the
  // responsive `<picture>` srcSet doesn't apply (browsers handle
  // these natively at any size). Stored as the original upload only.
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/x-icon",
] as const;
export type AllowedInputMimeType = (typeof ALLOWED_INPUT_MIME_TYPES)[number];

/**
 * MIME types that skip the sharp pipeline entirely — no variants, no
 * LQIP placeholder generation, original file written as-is. Renderers
 * (`Image.tsx`, `(public)/layout.tsx`) consult `isVectorFormat(ext)`
 * before deciding whether to look for variants.
 */
export const VECTOR_INPUT_MIME_TYPES = [
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/x-icon",
] as const;
export type VectorInputMimeType = (typeof VECTOR_INPUT_MIME_TYPES)[number];

export function isVectorMime(mime: string): mime is VectorInputMimeType {
  return (VECTOR_INPUT_MIME_TYPES as readonly string[]).includes(mime);
}

export function isVectorExt(ext: ImageMetadata["originalExt"]): boolean {
  return ext === "svg" || ext === "ico";
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

declare const imageIdBrand: unique symbol;
export type ImageId = string & { readonly [imageIdBrand]: never };
export const asImageId = (s: string): ImageId => s as ImageId;

/**
 * Focal point as a normalised (0..1) coordinate on the source image.
 * Applied as CSS `object-position` when the consumer crops the image
 * (e.g. ImageCarousel slides, hero containers) — `{x: 0.5, y: 0.5}`
 * is the natural default, no-op for un-cropped containers.
 */
export const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type FocalPoint = z.infer<typeof focalPointSchema>;

export const imageMetadataSchema = z.object({
  id: z.string().min(1).transform(asImageId),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placeholderDataUri: z.string().regex(/^data:image\/webp;base64,/),
  contentSlug: z.string().min(1),
  originalExt: z.enum(["jpg", "jpeg", "png", "webp", "avif", "svg", "ico"]),
  // Optional editorial metadata — parity with the legacy template's
  // `imageMetadataSchema`. Consumers use these as the canonical source
  // for caption / credit / focal-point; per-slot caption fields stay
  // available as overrides (carousel slide caption, photo tile caption).
  caption: z.string().optional(),
  credit: z.string().optional(),
  focalPoint: focalPointSchema.optional(),
});

export type ImageMetadata = z.infer<typeof imageMetadataSchema>;

/** Center of the image — the natural default for focal point. */
export const DEFAULT_FOCAL_POINT: FocalPoint = { x: 0.5, y: 0.5 };

/**
 * `object-position` value for an `ImageMetadata`. Returns `undefined`
 * when no focal point is set — callers can skip the inline style
 * entirely (the browser default `50% 50%` is the same as the focal
 * default, so emitting it would be visual no-op but reads as
 * intentional configuration).
 */
export function focalPointObjectPosition(
  focalPoint: FocalPoint | undefined,
): string | undefined {
  if (!focalPoint) return undefined;
  return `${focalPoint.x * 100}% ${focalPoint.y * 100}%`;
}

export const uploadResponseSchema = z.object({ ok: z.literal(true), image: imageMetadataSchema });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const uploadErrorSchema = z.object({ ok: z.literal(false), error: z.string() });
export type UploadError = z.infer<typeof uploadErrorSchema>;
