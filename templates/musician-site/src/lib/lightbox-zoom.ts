/**
 * Pure zoom/pan math for the photo lightbox's pinch-to-zoom gesture.
 * Kept free of React + DOM so the geometry is unit-testable without
 * synthesising touch events. The component owns the gesture wiring
 * (touch listeners, refs, state) and calls these for the maths.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Zoom transform state: a scale factor + a screen-pixel translation. */
export type ZoomState = {
  scale: number;
  tx: number;
  ty: number;
};

/** Not-zoomed identity state — the default + reset target. */
export const ZOOM_RESET: ZoomState = { scale: MIN_ZOOM, tx: 0, ty: 0 };

/** A minimal touch point shape — what we read off a `Touch`. */
export type Point = { clientX: number; clientY: number };

/**
 * Clamp a scale into the allowed zoom range. `NaN` (a 0/0 from a
 * degenerate pinch) falls back to MIN_ZOOM; ±Infinity clamp to the
 * range ends naturally via Math.min/max.
 */
export function clampZoomScale(scale: number): number {
  if (Number.isNaN(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Euclidean distance between two touch points (the pinch span). */
export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Whether the state represents a zoomed-in view (scale meaningfully
 * above 1). An epsilon guards against float drift leaving scale at
 * `1.0000001` after a pinch settles back — at which point one-finger
 * gestures should resume navigating, not panning.
 */
export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_ZOOM + 1e-3;
}

/**
 * Clamp the pan translation so the scaled image can't be dragged
 * past its own edges (no empty gutters between the image and the
 * viewport when zoomed). At scale `s`, an image rendered at
 * `renderedW × renderedH` overflows its un-scaled box by
 * `(s - 1) × size / 2` on each side — that overflow is the maximum
 * the image may translate before an edge pulls inward.
 *
 * `transform-origin: center` is assumed (the component sets it), so
 * the overflow is symmetric and the bound is ±maxOffset per axis.
 */
export function clampPan(
  state: ZoomState,
  renderedW: number,
  renderedH: number,
): ZoomState {
  const maxX = Math.max(0, ((state.scale - 1) * renderedW) / 2);
  const maxY = Math.max(0, ((state.scale - 1) * renderedH) / 2);
  return {
    scale: state.scale,
    tx: clampSymmetric(state.tx, maxX),
    ty: clampSymmetric(state.ty, maxY),
  };
}

function clampSymmetric(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

/**
 * Compute the next zoom state during a pinch. `startScale` is the
 * scale when the two fingers first touched down; the live ratio of
 * current span to start span multiplies it. Result is clamped to the
 * zoom range. Pan is preserved (re-clamped by the caller against the
 * new scale).
 *
 * A zero `startDistance` (both fingers reported the same point —
 * shouldn't happen, but guard it) yields MIN_ZOOM rather than
 * Infinity.
 */
export function pinchScale(
  startScale: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0) return MIN_ZOOM;
  return clampZoomScale(startScale * (currentDistance / startDistance));
}
