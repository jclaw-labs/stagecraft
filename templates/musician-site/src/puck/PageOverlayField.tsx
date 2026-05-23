"use client";

import { useId, type CSSProperties } from "react";

/**
 * Custom Puck root field for the per-page `pageBackgroundOverlay`.
 *
 * The on-disk contract distinguishes two states a bare `type:
 * "number"` field can't reliably express:
 *   - `null`   → inherit the site-wide `siteConfig.pageBackgroundOverlay`
 *   - `0..1`   → explicit per-page override (0 = no tint, 1 = opaque)
 *
 * Puck's number field has no clean "empty / cleared" state — clearing
 * it can serialise as `0`, which `extractPageRootProps` then reads as
 * an explicit no-tint override rather than "inherit." This field makes
 * the choice explicit: a radio picks Inherit vs Custom, and the slider
 * only shows (and only emits a number) under Custom. Inherit always
 * emits `null`, so the null-vs-0 distinction can never be lost to a
 * stray clear.
 */

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
};

/**
 * Starting tint when the artist first switches to Custom. 0 (no tint)
 * is the least-surprising default — an explicit override that's
 * visually a no-op until they drag the slider up, so flipping to
 * Custom never silently darkens the page.
 */
const CUSTOM_DEFAULT_OVERLAY = 0;

const STEP = 0.05;

export function PageOverlayField({ value, onChange }: Props) {
  const isInheriting = value === null || value === undefined;
  const numericValue = typeof value === "number" ? clamp01(value) : CUSTOM_DEFAULT_OVERLAY;
  // Unique per-instance group name + readout id. Radio groups are
  // document-global by `name`, so a hardcoded string would couple two
  // instances if this field were ever reused outside the singleton
  // root inspector. `useId` keeps each instance independent.
  const baseId = useId();
  const groupName = `${baseId}-mode`;
  const readoutId = `${baseId}-readout`;

  return (
    <div style={wrapperStyle}>
      <label style={radioRowStyle}>
        <input
          type="radio"
          name={groupName}
          checked={isInheriting}
          onChange={() => onChange(null)}
        />
        <span>Inherit site default</span>
      </label>
      <label style={radioRowStyle}>
        <input
          type="radio"
          name={groupName}
          checked={!isInheriting}
          // This radio only fires from the Inherit state (once the
          // value is a number, Custom is already checked), so the seed
          // is the default tint. Emitting a concrete number — not null
          // — is the point: the on-disk value flips from inherit to an
          // explicit override the moment Custom is chosen.
          onChange={() => onChange(numericValue)}
        />
        <span>Custom tint for this page</span>
      </label>

      {!isInheriting ? (
        <div style={sliderRowStyle}>
          <input
            type="range"
            min={0}
            max={1}
            step={STEP}
            value={numericValue}
            onChange={(e) => onChange(clamp01(Number(e.target.value)))}
            aria-label="Background tint opacity"
            aria-describedby={readoutId}
            style={sliderStyle}
            data-testid="page-overlay-slider"
          />
          <span id={readoutId} style={readoutStyle} data-testid="page-overlay-readout">
            {numericValue.toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

const wrapperStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const radioRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-emphasis)",
};

const sliderRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
};

const sliderStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
};

const readoutStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "var(--font-size-xs)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-muted)",
};
