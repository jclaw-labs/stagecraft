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

export const imageMetadataSchema = z.object({
  id: z.string().min(1).transform(asImageId),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placeholderDataUri: z.string().regex(/^data:image\/webp;base64,/),
  contentSlug: z.string().min(1),
  originalExt: z.enum(["jpg", "jpeg", "png", "webp", "avif", "svg", "ico"]),
});

export type ImageMetadata = z.infer<typeof imageMetadataSchema>;

export const uploadResponseSchema = z.object({ ok: z.literal(true), image: imageMetadataSchema });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const uploadErrorSchema = z.object({ ok: z.literal(false), error: z.string() });
export type UploadError = z.infer<typeof uploadErrorSchema>;
