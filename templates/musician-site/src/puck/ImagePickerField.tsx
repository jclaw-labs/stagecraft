"use client";

import { useRef, useState, type CSSProperties, type MouseEvent } from "react";

import {
  DEFAULT_FOCAL_POINT,
  type FocalPoint,
  type ImageMetadata,
} from "@/lib/image-types";
import {
  type UploadImageError,
  uploadImageFromClient,
} from "@/lib/upload-image-client";

type Props = {
  value: ImageMetadata | null;
  onChange: (next: ImageMetadata | null) => void;
};

/**
 * Editor-side custom field for image picking.
 *
 * Flow:
 *   1. Pre-upload: `<input type="file">` + alt-text input + Upload.
 *      `uploadImageFromClient` POSTs to /api/upload-image, returns
 *      `ImageMetadata`; the field stores it via onChange.
 *   2. Post-upload: the preview becomes a focal-point picker (click
 *      to set), and inline edit fields appear for alt / caption /
 *      credit / focal-point. These mutate the metadata locally
 *      (no server round-trip) — the route's sharp pipeline only
 *      needs to run when the underlying bytes change.
 *
 * Rendered only on the editor side (Puck calls this in the admin UI).
 * The public render path uses the Image block's `render` function with
 * the same `ImageMetadata` value — see puck/config.tsx.
 */
export function ImagePickerField({ value, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [alt, setAlt] = useState(value?.alt ?? "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSrc =
    value && `/images/${value.contentSlug}/${value.id}/${Math.min(800, value.width)}.webp`;

  function reset() {
    setPendingFile(null);
    setAlt(value?.alt ?? "");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUpload() {
    if (!pendingFile) return;
    setIsUploading(true);
    setError(null);
    try {
      const metadata = await uploadImageFromClient({ file: pendingFile, alt });
      onChange(metadata);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (cause) {
      const e = cause as UploadImageError;
      setError(e?.message ?? "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function handleClear() {
    onChange(null);
    reset();
  }

  // Post-upload field editors. These mutate the metadata locally —
  // no server round-trip. The route layer also accepts the same
  // fields at upload time, but routing UI edits through onChange
  // avoids re-running the sharp pipeline for an alt-text fix.
  function patchValue(patch: Partial<ImageMetadata>): void {
    if (!value) return;
    const next: ImageMetadata = { ...value, ...patch };
    // Strip explicitly-cleared optional fields so the persisted JSON
    // doesn't carry `caption: undefined` (which JSON.stringify drops
    // anyway, but we want the type shape to match).
    if (patch.caption === "") delete next.caption;
    if (patch.credit === "") delete next.credit;
    onChange(next);
  }

  function handleFocalPointClick(event: MouseEvent<HTMLImageElement>): void {
    if (!value) return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    patchValue({ focalPoint: { x, y } });
  }

  function handleFocalPointReset(): void {
    if (!value) return;
    const next = { ...value };
    delete next.focalPoint;
    onChange(next);
  }

  const focalPoint = value?.focalPoint;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {value && previewSrc ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ position: "relative" }}>
            {/* Click anywhere on the preview to set the focal point.
                `object-fit: contain` keeps the image's intrinsic
                aspect ratio so the click coordinates map 1:1 onto
                the source image — `cover` would distort the
                relationship. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={value.alt}
              onClick={handleFocalPointClick}
              style={{
                display: "block",
                maxWidth: "100%",
                height: "auto",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                cursor: "crosshair",
              }}
              data-testid="image-picker-preview"
            />
            {focalPoint ? (
              <FocalPointMarker focalPoint={focalPoint} />
            ) : null}
          </div>
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            {value.width}×{value.height} · {value.originalExt}
          </div>

          <label style={fieldLabelStyle}>
            Alt text (describe the image for screen readers)
            <input
              type="text"
              value={value.alt}
              onChange={(e) => patchValue({ alt: e.target.value })}
              placeholder="e.g. Sarah Chen at the Riverside Theater"
              style={textInputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            Caption (optional — shown alongside the image where supported)
            <input
              type="text"
              value={value.caption ?? ""}
              onChange={(e) => patchValue({ caption: e.target.value })}
              placeholder="e.g. Soundcheck at the Fillmore"
              style={textInputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            Credit (optional — e.g. photographer credit)
            <input
              type="text"
              value={value.credit ?? ""}
              onChange={(e) => patchValue({ credit: e.target.value })}
              placeholder="e.g. Photo by Jane Smith"
              style={textInputStyle}
            />
          </label>

          <div style={fieldLabelStyle}>
            <span>
              Focal point — click the image to set where it stays in
              focus when cropped
            </span>
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
                alignItems: "center",
                marginTop: "var(--space-1)",
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              <span>
                {focalPoint
                  ? `x: ${focalPoint.x.toFixed(2)}, y: ${focalPoint.y.toFixed(2)}`
                  : `default (center: x: ${DEFAULT_FOCAL_POINT.x.toFixed(2)}, y: ${DEFAULT_FOCAL_POINT.y.toFixed(2)})`}
              </span>
              {focalPoint ? (
                <button
                  type="button"
                  onClick={handleFocalPointReset}
                  style={secondaryButtonStyle}
                >
                  Reset to center
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={handleClear}
            style={secondaryButtonStyle}
          >
            Remove image
          </button>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml,image/vnd.microsoft.icon,image/x-icon"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setPendingFile(f);
          setError(null);
        }}
      />
      {pendingFile ? (
        <>
          <label style={fieldLabelStyle}>
            Alt text (describe the image for screen readers)
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="e.g. Sarah Chen at the Riverside Theater"
              style={textInputStyle}
            />
          </label>
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            style={{
              padding: "var(--space-1) var(--space-3)",
              fontSize: "var(--font-size-sm)",
              border: "1px solid var(--color-action)",
              background: isUploading ? "var(--color-action-disabled)" : "var(--color-action)",
              color: "var(--color-action-fg)",
              cursor: isUploading ? "wait" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {isUploading ? "Uploading…" : value ? "Replace image" : "Upload image"}
          </button>
        </>
      ) : null}
      {error ? (
        <div role="alert" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-error)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function FocalPointMarker({ focalPoint }: { focalPoint: FocalPoint }) {
  // Crosshair marker pinned at the focal-point coordinate.
  // `translate(-50%, -50%)` centers the marker on its anchor so the
  // visual centroid lines up with the click point.
  // `pointer-events: none` so the marker doesn't swallow click
  // events meant for the underlying picker image.
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: `${focalPoint.x * 100}%`,
        top: `${focalPoint.y * 100}%`,
        width: "1.25rem",
        height: "1.25rem",
        marginLeft: "-0.625rem",
        marginTop: "-0.625rem",
        borderRadius: "50%",
        border: "2px solid var(--color-action-fg)",
        boxShadow: "0 0 0 2px var(--color-action), var(--shadow-md)",
        background: "var(--color-action)",
        pointerEvents: "none",
      }}
      data-testid="image-picker-focal-marker"
    />
  );
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

const fieldLabelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-emphasis)",
};

const textInputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "var(--space-1)",
  padding: "var(--space-1) var(--space-2)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-size-sm)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-xs)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  cursor: "pointer",
  alignSelf: "flex-start",
};
