/**
 * Render the page-body Puck config's components in the editor's
 * component drawer with a live preview rendered from their
 * `defaultProps`, instead of just a label.
 *
 * Wired into Puck via `overrides.drawerItem`. The override receives
 * `{ name, children }`; we keep `children` (Puck's default label +
 * drag affordance) and add a small clipped preview above it.
 *
 * Per-component policy:
 *
 * - **Live render from `defaultProps`** for primitives whose render
 *   is pure markup at thumbnail scale (Heading, RichText, Quote,
 *   Button, Image, ContactForm). These render in a sandbox box
 *   scaled down by CSS transform; the artist sees the actual visual
 *   the block produces.
 *
 * - **Static name-pill fallback** for blocks where a thumbnail-scale
 *   live render would be useless or actively wrong — see
 *   `STATIC_PREVIEW_BLOCKS` below for the per-block rationale.
 *
 * - **Slot containers** (Section, Columns) — detected at runtime by
 *   scanning fields for `type: "slot"`. Their render does
 *   `<Children />`, which throws when handed the raw `[]` from
 *   `defaultProps` instead of Puck's slot-render function.
 *
 * - **Catch-all fallback** — same static name pill if rendering
 *   throws, if `defaultProps` is missing, or if the component isn't
 *   in the registry. Defensive — a buggy block doesn't blow up the
 *   drawer.
 *
 * The preview box has `pointer-events: none` so it doesn't intercept
 * Puck's drag-to-canvas affordance; the surrounding row still
 * functions as a draggable component-list item.
 */

"use client";

import type { ComponentType, CSSProperties, ReactNode } from "react";

import type { BlockProps } from "./config";
import { puckConfig } from "./config";

/**
 * Component names that are unsuitable for a thumbnail-scale live
 * preview. These fall back to a static name pill. Typed against
 * `BlockProps` so renaming a block surfaces here at compile time.
 *
 *   - **Embed** — default render emits a Spotify `<iframe>`; loading
 *     it on every editor mount would hit the network needlessly.
 *   - **EmbedResponsive** — same reasoning as Embed; default props
 *     ship a Bandcamp iframe URL.
 *   - **FullscreenSection** — render pins to `minHeight: 80vh` and
 *     flex-centers content; at top-left scaled 0.55 in a 5rem box,
 *     the preview is just empty hero whitespace.
 *   - **Spacer** — render IS empty space (its purpose). Live preview
 *     is honest but uninformative.
 *   - **Divider** — render is a 1px `<hr>` whose line vanishes at
 *     thumbnail scale.
 *   - **Gallery** — defaultProps are empty image tiles, so the live
 *     render is just decorative gradient blocks with no context.
 *
 * The page editor's generic Collection blocks (`TourDatesView` etc., added by
 * `buildUnifiedEditorConfig`) aren't in `puckConfig.components`, so they fall
 * through to the static name-pill via the not-in-registry branch below — no
 * `STATIC_PREVIEW_BLOCKS` entry needed.
 *
 * Slot containers (Section, Columns) are detected automatically by
 * scanning `fields` for `{ type: "slot" }` — their `defaultProps`
 * carry the slot as a raw `[]` which React rejects when the render
 * does `<Children />`. Detecting the shape is more durable than
 * maintaining a parallel list.
 */
const STATIC_PREVIEW_BLOCKS = new Set<keyof BlockProps>([
  "Embed",
  "EmbedResponsive",
  "FullscreenSection",
  "Spacer",
  "Divider",
  "Gallery",
]);

type ConfigComponent = {
  render?: ComponentType<object>;
  defaultProps?: object;
  fields?: Record<string, { type?: string } | undefined>;
};

function hasSlotField(component: ConfigComponent): boolean {
  if (!component.fields) return false;
  return Object.values(component.fields).some((field) => field?.type === "slot");
}

export function DrawerItemPreview({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div style={containerStyle}>
      <PreviewBox name={name} />
      <div>{children}</div>
    </div>
  );
}

function PreviewBox({ name }: { name: string }) {
  if (STATIC_PREVIEW_BLOCKS.has(name as keyof BlockProps)) {
    return <StaticFallback name={name} />;
  }
  const component = (
    puckConfig.components as unknown as Record<string, ConfigComponent>
  )[name];
  if (!component?.render || !component.defaultProps) {
    return <StaticFallback name={name} />;
  }
  if (hasSlotField(component)) {
    // Slot-container render expects Puck to have replaced the slot
    // value with a render function before calling. Raw defaultProps
    // hands the render an empty array, and `<Children />` throws.
    return <StaticFallback name={name} />;
  }
  const Component = component.render;
  let rendered: ReactNode;
  try {
    rendered = <Component {...component.defaultProps} />;
  } catch {
    return <StaticFallback name={name} />;
  }
  return (
    <div style={previewBoxStyle} aria-hidden>
      <div style={scaledStyle}>{rendered}</div>
    </div>
  );
}

function StaticFallback({ name }: { name: string }) {
  return (
    <div style={fallbackBoxStyle} aria-hidden>
      <span style={fallbackLabelStyle}>{name}</span>
    </div>
  );
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

// Scale the natural-size block render down so a typical heading / section
// intro fits in the preview box. The compensating width/height reverses
// the scale so layout still computes against the natural box (otherwise
// text wraps at the shrunk width). The two values are mathematically
// linked — keep them derived from PREVIEW_SCALE so they can't drift.
const PREVIEW_SCALE = 0.55;
const PREVIEW_COMPENSATION = `${100 / PREVIEW_SCALE}%`;

const previewBoxStyle: CSSProperties = {
  width: "100%",
  height: "var(--space-20)",
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
  pointerEvents: "none",
  background: "var(--color-surface)",
  position: "relative",
};

const scaledStyle: CSSProperties = {
  // transform-origin top-left pins the visible portion to the top of
  // the component's render so the preview shows its first lines.
  transform: `scale(${PREVIEW_SCALE})`,
  transformOrigin: "top left",
  width: PREVIEW_COMPENSATION,
  height: PREVIEW_COMPENSATION,
};

const fallbackBoxStyle: CSSProperties = {
  width: "100%",
  height: "var(--space-20)",
  border: "1px dashed var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

const fallbackLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-mono)",
};
