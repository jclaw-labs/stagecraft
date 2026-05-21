import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { computeImageId, imageDir, processImage, variantFilename } from "./image";
import {
  IMAGE_VARIANT_FORMATS,
  IMAGE_VARIANT_WIDTHS,
  imageMetadataSchema,
} from "./image-types";

const TEST_SLUG = "__test__";
const TEST_PUBLIC = path.join(process.cwd(), "public/images", TEST_SLUG);

async function cleanup() {
  await fs.rm(TEST_PUBLIC, { recursive: true, force: true });
}

beforeEach(cleanup);
afterAll(cleanup);

async function makeFixture(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 64, g: 128, b: 192 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

describe("computeImageId", () => {
  it("is deterministic for the same bytes", () => {
    const a = Buffer.from("hello world");
    expect(computeImageId(a)).toBe(computeImageId(a));
  });

  it("differs across different bytes", () => {
    expect(computeImageId(Buffer.from("a"))).not.toBe(computeImageId(Buffer.from("b")));
  });

  it("returns a 16-char hex id", () => {
    expect(computeImageId(Buffer.from("x"))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("processImage", () => {
  it("writes original + all variants + returns valid metadata", async () => {
    const buffer = await makeFixture();
    const result = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "test",
      originalExt: "jpg",
    });

    expect(result.processed).toBe(true);
    expect(imageMetadataSchema.safeParse(result.metadata).success).toBe(true);

    const dir = imageDir(TEST_SLUG, result.metadata.id);
    await expect(fs.stat(path.join(dir, "original.jpg"))).resolves.toBeTruthy();
    for (const w of IMAGE_VARIANT_WIDTHS) {
      for (const f of IMAGE_VARIANT_FORMATS) {
        await expect(fs.stat(path.join(dir, variantFilename(w, f)))).resolves.toBeTruthy();
      }
    }
  });

  it("metadata width/height match the source", async () => {
    const buffer = await makeFixture(640, 480);
    const result = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "x",
      originalExt: "jpg",
    });
    expect(result.metadata.width).toBe(640);
    expect(result.metadata.height).toBe(480);
  });

  it("LQIP placeholder is a small base64 webp", async () => {
    const buffer = await makeFixture();
    const result = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "x",
      originalExt: "jpg",
    });
    expect(result.metadata.placeholderDataUri).toMatch(/^data:image\/webp;base64,/);
    const base64 = result.metadata.placeholderDataUri.split(",")[1] ?? "";
    expect(base64.length).toBeGreaterThan(0);
    expect(base64.length).toBeLessThan(2_000);
  });

  it("doesn't enlarge variants beyond source width", async () => {
    const buffer = await makeFixture(500, 400);
    const result = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "x",
      originalExt: "jpg",
    });
    const dir = imageDir(TEST_SLUG, result.metadata.id);
    const big = await sharp(path.join(dir, "1600.webp")).metadata();
    expect(big.width).toBeLessThanOrEqual(500);
  });

  it("dedups: re-uploading the same bytes skips processing", async () => {
    const buffer = await makeFixture();
    const first = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "x",
      originalExt: "jpg",
    });
    expect(first.processed).toBe(true);

    const second = await processImage({
      buffer,
      contentSlug: TEST_SLUG,
      alt: "x",
      originalExt: "jpg",
    });
    expect(second.processed).toBe(false);
    expect(second.metadata.id).toBe(first.metadata.id);
  });

  it("different bytes produce different ids and directories", async () => {
    const a = await processImage({
      buffer: await makeFixture(640, 480),
      contentSlug: TEST_SLUG,
      alt: "a",
      originalExt: "jpg",
    });
    const b = await processImage({
      buffer: await makeFixture(641, 480),
      contentSlug: TEST_SLUG,
      alt: "b",
      originalExt: "jpg",
    });
    expect(a.metadata.id).not.toBe(b.metadata.id);
  });

  // EXIF rotation handling is wired in source (sharp().rotate() before sizing/metadata
  // reads — see processImage). Programmatic generation of a real EXIF-rotated JPEG
  // varies across sharp versions; verified manually with an iOS portrait photo.
});

// ---------------------------------------------------------------------------
// Vector / icon formats (SVG + ICO) bypass the sharp variant pipeline.
// The favicon UI in Site Settings explicitly accepts these — the legacy
// template's `siteConfig.favicon` was a freeform string path; raster-only
// favicons were a regression introduced by routing the field through the
// sharp upload pipeline. These tests lock the bypass behaviour.
// ---------------------------------------------------------------------------

describe("processImage — vector / icon bypass (SVG + ICO)", () => {
  /**
   * Tiny valid SVG. Real SVG payload, not a placeholder — the test
   * asserts sharp doesn't touch this content (no rasterisation,
   * no LQIP regeneration).
   */
  const SVG_BYTES = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#abc"/></svg>',
    "utf-8",
  );

  /**
   * Minimal 16×16 ICO header. Sharp can't parse ICO at all — verifies
   * the bypass path is hit (otherwise this test crashes on
   * `sharp(buffer).metadata()`).
   */
  const ICO_BYTES = Buffer.from([
    0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 64, 4, 0, 0, 22, 0, 0, 0,
  ]);

  it("SVG: writes original.svg, no variant files, default dimensions", async () => {
    const result = await processImage({
      buffer: SVG_BYTES,
      contentSlug: TEST_SLUG,
      alt: "logo",
      originalExt: "svg",
    });
    expect(result.processed).toBe(true);
    expect(imageMetadataSchema.safeParse(result.metadata).success).toBe(true);
    expect(result.metadata.originalExt).toBe("svg");

    const dir = imageDir(TEST_SLUG, result.metadata.id);
    await expect(fs.stat(path.join(dir, "original.svg"))).resolves.toBeTruthy();
    // No sharp variants written — vectors are scalable, srcSet doesn't apply.
    for (const w of IMAGE_VARIANT_WIDTHS) {
      for (const f of IMAGE_VARIANT_FORMATS) {
        await expect(fs.stat(path.join(dir, variantFilename(w, f)))).rejects.toBeTruthy();
      }
    }
  });

  it("ICO: writes original.ico, no variant files (sharp can't parse ICO at all)", async () => {
    const result = await processImage({
      buffer: ICO_BYTES,
      contentSlug: TEST_SLUG,
      alt: "icon",
      originalExt: "ico",
    });
    expect(result.processed).toBe(true);
    expect(result.metadata.originalExt).toBe("ico");

    const dir = imageDir(TEST_SLUG, result.metadata.id);
    await expect(fs.stat(path.join(dir, "original.ico"))).resolves.toBeTruthy();
    for (const w of IMAGE_VARIANT_WIDTHS) {
      for (const f of IMAGE_VARIANT_FORMATS) {
        await expect(fs.stat(path.join(dir, variantFilename(w, f)))).rejects.toBeTruthy();
      }
    }
  });

  it("SVG content is written byte-for-byte (sharp didn't rasterise it)", async () => {
    const result = await processImage({
      buffer: SVG_BYTES,
      contentSlug: TEST_SLUG,
      alt: "logo",
      originalExt: "svg",
    });
    const dir = imageDir(TEST_SLUG, result.metadata.id);
    const written = await fs.readFile(path.join(dir, "original.svg"));
    expect(written.equals(SVG_BYTES)).toBe(true);
  });

  it("dedup on re-upload: same buffer → same id, processed=false, no sharp re-parse", async () => {
    // First upload writes; second hits the existing-original branch.
    // The dedup branch's `readImageMetadata` must also bypass sharp
    // for vectors — otherwise re-uploading an ICO crashes (sharp
    // can't read it).
    const first = await processImage({
      buffer: ICO_BYTES,
      contentSlug: TEST_SLUG,
      alt: "icon",
      originalExt: "ico",
    });
    const second = await processImage({
      buffer: ICO_BYTES,
      contentSlug: TEST_SLUG,
      alt: "icon",
      originalExt: "ico",
    });
    expect(second.processed).toBe(false);
    expect(second.metadata.id).toBe(first.metadata.id);
  });

  it("metadata satisfies the schema's placeholderDataUri regex", async () => {
    const result = await processImage({
      buffer: SVG_BYTES,
      contentSlug: TEST_SLUG,
      alt: "logo",
      originalExt: "svg",
    });
    expect(result.metadata.placeholderDataUri).toMatch(/^data:image\/webp;base64,/);
  });
});
