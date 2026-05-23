import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOCAL_POINT,
  asImageId,
  focalPointObjectPosition,
  focalPointSchema,
  imageMetadataSchema,
  type ImageMetadata,
} from "./image-types";

const BASE_META: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "A photo",
  width: 1600,
  height: 1067,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "home",
  originalExt: "jpg",
};

describe("imageMetadataSchema — editorial metadata", () => {
  it("accepts metadata without the optional fields (existing on-disk content)", () => {
    // Forward-compat: existing content files were written before the
    // optional fields existed, so they must keep validating.
    expect(imageMetadataSchema.safeParse(BASE_META).success).toBe(true);
  });

  it("accepts caption + credit + focalPoint when present", () => {
    const parsed = imageMetadataSchema.safeParse({
      ...BASE_META,
      caption: "Soundcheck",
      credit: "Photo by Jane Smith",
      focalPoint: { x: 0.3, y: 0.7 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.caption).toBe("Soundcheck");
      expect(parsed.data.credit).toBe("Photo by Jane Smith");
      expect(parsed.data.focalPoint).toEqual({ x: 0.3, y: 0.7 });
    }
  });

  it("rejects focalPoint with out-of-range coordinates", () => {
    // 0..1 is the contract — values outside that range would produce
    // an unbounded `object-position` percentage.
    expect(
      imageMetadataSchema.safeParse({
        ...BASE_META,
        focalPoint: { x: -0.1, y: 0.5 },
      }).success,
    ).toBe(false);
    expect(
      imageMetadataSchema.safeParse({
        ...BASE_META,
        focalPoint: { x: 0.5, y: 1.1 },
      }).success,
    ).toBe(false);
  });

  it("rejects focalPoint missing a coordinate", () => {
    expect(
      imageMetadataSchema.safeParse({
        ...BASE_META,
        focalPoint: { x: 0.5 },
      }).success,
    ).toBe(false);
  });

  it("accepts focalPoint at the corners (0,0 and 1,1)", () => {
    expect(
      focalPointSchema.safeParse({ x: 0, y: 0 }).success,
    ).toBe(true);
    expect(
      focalPointSchema.safeParse({ x: 1, y: 1 }).success,
    ).toBe(true);
  });
});

describe("focalPointObjectPosition", () => {
  it("returns undefined when no focal point is set", () => {
    // Caller can skip the inline style entirely — the browser default
    // is already `50% 50%`, the same as the default focal point.
    expect(focalPointObjectPosition(undefined)).toBeUndefined();
  });

  it("serialises a focal point to a CSS `<percent> <percent>` value", () => {
    expect(focalPointObjectPosition({ x: 0.25, y: 0.75 })).toBe("25% 75%");
  });

  it("handles the corners + center", () => {
    expect(focalPointObjectPosition({ x: 0, y: 0 })).toBe("0% 0%");
    expect(focalPointObjectPosition({ x: 1, y: 1 })).toBe("100% 100%");
    expect(focalPointObjectPosition(DEFAULT_FOCAL_POINT)).toBe("50% 50%");
  });

  it("rounds FP artifacts out of the rendered CSS", () => {
    // Without rounding, 0.33 * 100 → "33.000000000000004"; the
    // browser parses it but the CSS leaks FP noise into DevTools.
    expect(focalPointObjectPosition({ x: 0.33, y: 0.67 })).toBe("33% 67%");
    expect(focalPointObjectPosition({ x: 0.1, y: 0.2 })).toBe("10% 20%");
  });

  it("keeps two-decimal precision for fine clicks", () => {
    // The picker's `clamp01((event.clientX - rect.left) / rect.width)`
    // can produce values like 0.5125 (a click at pixel 41 of an 80-
    // pixel preview); we want that recorded faithfully, not snapped
    // to a coarser grid.
    expect(focalPointObjectPosition({ x: 0.5125, y: 0.25 })).toBe("51.25% 25%");
  });
});
