import { describe, expect, it } from "vitest";

import {
  clampPan,
  clampZoomScale,
  isZoomed,
  MAX_ZOOM,
  MIN_ZOOM,
  pinchScale,
  touchDistance,
  ZOOM_RESET,
} from "./lightbox-zoom";

describe("clampZoomScale", () => {
  it("keeps in-range scales unchanged", () => {
    expect(clampZoomScale(1)).toBe(1);
    expect(clampZoomScale(2.5)).toBe(2.5);
    expect(clampZoomScale(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it("clamps below MIN_ZOOM up and above MAX_ZOOM down", () => {
    expect(clampZoomScale(0.2)).toBe(MIN_ZOOM);
    expect(clampZoomScale(99)).toBe(MAX_ZOOM);
  });

  it("falls back to MIN_ZOOM on non-finite input", () => {
    expect(clampZoomScale(NaN)).toBe(MIN_ZOOM);
    expect(clampZoomScale(Infinity)).toBe(MAX_ZOOM);
  });
});

describe("touchDistance", () => {
  it("computes the Euclidean span between two points", () => {
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });

  it("is zero for coincident points", () => {
    expect(touchDistance({ clientX: 10, clientY: 10 }, { clientX: 10, clientY: 10 })).toBe(0);
  });
});

describe("isZoomed", () => {
  it("is false at exactly 1 (and within epsilon)", () => {
    expect(isZoomed(ZOOM_RESET)).toBe(false);
    expect(isZoomed({ scale: 1.0000001, tx: 0, ty: 0 })).toBe(false);
  });

  it("is true once meaningfully above 1", () => {
    expect(isZoomed({ scale: 1.5, tx: 0, ty: 0 })).toBe(true);
    expect(isZoomed({ scale: MAX_ZOOM, tx: 0, ty: 0 })).toBe(true);
  });
});

describe("pinchScale", () => {
  it("scales the start scale by the span ratio", () => {
    // Fingers moved twice as far apart → 2× the start scale.
    expect(pinchScale(1, 100, 200)).toBe(2);
    // Pinched together to half → 0.5× start, clamped up to MIN_ZOOM.
    expect(pinchScale(2, 100, 50)).toBe(1);
  });

  it("clamps the result into the zoom range", () => {
    expect(pinchScale(2, 100, 1000)).toBe(MAX_ZOOM);
  });

  it("guards a zero start distance (returns MIN_ZOOM, not Infinity)", () => {
    expect(pinchScale(2, 0, 100)).toBe(MIN_ZOOM);
  });
});

describe("clampPan", () => {
  it("allows no translation at scale 1 (nothing overflows)", () => {
    const out = clampPan({ scale: 1, tx: 50, ty: 50 }, 400, 300);
    expect(out.tx).toBe(0);
    expect(out.ty).toBe(0);
  });

  it("bounds translation to the scaled overflow on each axis", () => {
    // At scale 2 over a 400×300 render, overflow is (2-1)*size/2 =
    // 200 wide, 150 tall.
    const within = clampPan({ scale: 2, tx: 100, ty: 100 }, 400, 300);
    expect(within.tx).toBe(100);
    expect(within.ty).toBe(100);

    const beyond = clampPan({ scale: 2, tx: 500, ty: -500 }, 400, 300);
    expect(beyond.tx).toBe(200);
    expect(beyond.ty).toBe(-150);
  });

  it("preserves the scale and zeroes non-finite translations", () => {
    const out = clampPan({ scale: 3, tx: NaN, ty: 10 }, 400, 300);
    expect(out.scale).toBe(3);
    expect(out.tx).toBe(0);
    expect(out.ty).toBe(10);
  });
});
