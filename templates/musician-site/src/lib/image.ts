import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  IMAGE_VARIANT_FORMATS,
  IMAGE_VARIANT_WIDTHS,
  type FocalPoint,
  type ImageId,
  type ImageMetadata,
  type ImageVariantFormat,
  type ImageVariantWidth,
  asImageId,
  isVectorExt,
} from "./image-types";

const PUBLIC_IMAGES_DIR = path.join(process.cwd(), "public/images");
const HASH_LENGTH = 16;
const PLACEHOLDER_WIDTH = 20;

/**
 * Static LQIP placeholder for vector / icon uploads. Sharp would
 * rasterise SVG (slow + a couple of historical CVEs) and can't parse
 * ICO at all, so we don't synthesise a real placeholder for these.
 * The renderer's `<picture>` flow doesn't fire for vectors anyway —
 * the value only has to satisfy `imageMetadataSchema`'s regex.
 *
 * 1×1 transparent webp.
 */
const VECTOR_PLACEHOLDER_DATA_URI =
  "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

/**
 * Default width/height used in metadata for vector / icon uploads.
 * Vectors are scalable; the value is advisory and only affects the
 * variant-URL helper's eligibility check (which short-circuits for
 * vector formats anyway). Picked at 1024 so a downstream consumer
 * that hasn't yet learned about `isVectorExt` still picks a
 * reasonable srcSet width if it falls through.
 */
const VECTOR_NOMINAL_DIMENSION = 1024;

export type ProcessImageInput = {
  buffer: Buffer;
  contentSlug: string;
  alt: string;
  originalExt: ImageMetadata["originalExt"];
  /** Editorial metadata threaded straight into the returned ImageMetadata. */
  caption?: string;
  credit?: string;
  focalPoint?: FocalPoint;
};

export type ProcessImageResult = {
  metadata: ImageMetadata;
  /** True when sharp ran. False when an existing original was found at the target path. */
  processed: boolean;
};

/**
 * One generated image variant: width × format → bytes. Used by both the
 * local-disk path (writes to public/images) and the broker path (commits
 * via GitHub).
 */
export type ImageVariant = {
  width: ImageVariantWidth;
  format: ImageVariantFormat;
  buffer: Buffer;
};

export type GenerateImageVariantsResult = {
  metadata: ImageMetadata;
  /** Original input bytes — same buffer that was passed in, for the destination to write. */
  originalBuffer: Buffer;
  /** All resized + reformatted variants. */
  variants: ImageVariant[];
};

export function computeImageId(buffer: Buffer): ImageId {
  const hex = createHash("sha256").update(buffer).digest("hex").slice(0, HASH_LENGTH);
  return asImageId(hex);
}

export function imageDir(contentSlug: string, id: ImageId): string {
  return path.join(PUBLIC_IMAGES_DIR, contentSlug, id);
}

export function variantFilename(width: ImageVariantWidth, format: ImageVariantFormat): string {
  return `${width}.${format}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the original + resized variants + placeholder LQIP for an
 * uploaded image, all in memory. No disk writes — the destination
 * (local-fs vs GitHub via the broker) is the caller's responsibility.
 *
 * Deterministic over `input.buffer`: same input → same metadata + buffers,
 * which lets callers safely re-upload duplicate images without divergent
 * results.
 */
export async function generateImageVariants(
  input: ProcessImageInput,
): Promise<GenerateImageVariantsResult> {
  const id = computeImageId(input.buffer);

  // Vector / icon formats bypass sharp entirely. The original file is
  // stored as-is; no resize variants and no LQIP placeholder generation
  // (sharp can rasterise SVG but the output wouldn't be useful for the
  // variant `<picture>` flow, which doesn't fire for vectors). Default
  // dimensions are advisory — `isVectorExt` keeps consumers off the
  // variant code paths.
  //
  // Security note: SVGs are written byte-for-byte without sanitisation,
  // so an uploaded SVG with `<script>` would run if a visitor opened
  // its URL directly (top-level document context). The upload endpoint
  // is admin-only — only the authenticated site owner can land content
  // here — so the practical attack surface today is "the artist
  // uploaded a malicious SVG knowingly." When contributor / fan-
  // submitted uploads land in a future PR, this bypass needs a
  // DOMPurify (SVG profile) pass + a `Content-Disposition: attachment`
  // header on the response. Tracked in the parity audit.
  if (isVectorExt(input.originalExt)) {
    return {
      metadata: {
        id,
        alt: input.alt,
        width: VECTOR_NOMINAL_DIMENSION,
        height: VECTOR_NOMINAL_DIMENSION,
        placeholderDataUri: VECTOR_PLACEHOLDER_DATA_URI,
        contentSlug: input.contentSlug,
        originalExt: input.originalExt,
        ...editorialMetadata(input),
      },
      originalBuffer: input.buffer,
      variants: [],
    };
  }

  const meta = await sharp(input.buffer).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("could not read image dimensions");
  }

  const variants = await Promise.all(
    IMAGE_VARIANT_WIDTHS.flatMap((variantWidth) =>
      IMAGE_VARIANT_FORMATS.map(async (format): Promise<ImageVariant> => {
        const pipeline = sharp(input.buffer)
          .rotate()
          .resize({ width: Math.min(variantWidth, width), withoutEnlargement: true });
        const buffer = await (format === "webp"
          ? pipeline.webp({ quality: 80 }).toBuffer()
          : pipeline.avif({ quality: 60 }).toBuffer());
        return { width: variantWidth, format, buffer };
      }),
    ),
  );

  const placeholderBuffer = await sharp(input.buffer)
    .rotate()
    .resize({ width: PLACEHOLDER_WIDTH })
    .webp({ quality: 30 })
    .toBuffer();
  const placeholderDataUri = `data:image/webp;base64,${placeholderBuffer.toString("base64")}`;

  return {
    metadata: {
      id,
      alt: input.alt,
      width,
      height,
      placeholderDataUri,
      contentSlug: input.contentSlug,
      originalExt: input.originalExt,
      ...editorialMetadata(input),
    },
    originalBuffer: input.buffer,
    variants,
  };
}

/**
 * Spread-helper for the optional editorial fields. Keeps the metadata
 * literals above readable AND keeps `caption: undefined` out of the
 * persisted JSON (zod's `.optional()` allows `undefined`, but a
 * Puck/JSON.stringify roundtrip drops the key — we want the same
 * shape on first write).
 */
function editorialMetadata(input: ProcessImageInput): Partial<ImageMetadata> {
  const out: Partial<ImageMetadata> = {};
  if (input.caption !== undefined) out.caption = input.caption;
  if (input.credit !== undefined) out.credit = input.credit;
  if (input.focalPoint !== undefined) out.focalPoint = input.focalPoint;
  return out;
}

/**
 * Process an uploaded image: generate variants, write to disk, return metadata.
 * Idempotent: if the original (by content hash) already exists at the target path,
 * skip processing and return existing metadata.
 */
export async function processImage(input: ProcessImageInput): Promise<ProcessImageResult> {
  const id = computeImageId(input.buffer);
  const dir = imageDir(input.contentSlug, id);
  const originalPath = path.join(dir, `original.${input.originalExt}`);

  if (await fileExists(originalPath)) {
    const metadata = await readImageMetadata(input);
    return { metadata, processed: false };
  }

  const generated = await generateImageVariants(input);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(originalPath, generated.originalBuffer);
  await Promise.all(
    generated.variants.map((v) =>
      fs.writeFile(path.join(dir, variantFilename(v.width, v.format)), v.buffer),
    ),
  );

  return { metadata: generated.metadata, processed: true };
}

async function readImageMetadata(input: ProcessImageInput): Promise<ImageMetadata> {
  const { contentSlug, alt, originalExt } = input;
  const id = computeImageId(input.buffer);
  // Vector re-upload: skip sharp (won't parse ICO; would rasterise
  // SVG). Mirrors the vector branch in `generateImageVariants` —
  // the synthesised metadata must agree so dedup vs first-upload
  // doesn't produce divergent `width` / `placeholderDataUri`.
  if (isVectorExt(originalExt)) {
    return {
      id,
      alt,
      width: VECTOR_NOMINAL_DIMENSION,
      height: VECTOR_NOMINAL_DIMENSION,
      placeholderDataUri: VECTOR_PLACEHOLDER_DATA_URI,
      contentSlug,
      originalExt,
      ...editorialMetadata(input),
    };
  }
  const dir = imageDir(contentSlug, id);
  const buffer = await fs.readFile(path.join(dir, `original.${originalExt}`));
  const meta = await sharp(buffer).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const placeholderBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: PLACEHOLDER_WIDTH })
    .webp({ quality: 30 })
    .toBuffer();
  return {
    id,
    alt,
    width,
    height,
    placeholderDataUri: `data:image/webp;base64,${placeholderBuffer.toString("base64")}`,
    contentSlug,
    originalExt,
    ...editorialMetadata(input),
  };
}
