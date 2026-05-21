"use client";

import { useRef, useState } from "react";

import { type ImageMetadata } from "@/lib/image-types";
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
 * Composes:
 *   1. native `<input type="file">` to grab a File
 *   2. `<input type="text">` for the alt text
 *   3. `uploadImageFromClient` (POSTs to /api/upload-image, returns ImageMetadata)
 *   4. stores the returned ImageMetadata as the field's value
 *
 * Rendered only on the editor side (Puck calls this in the admin UI). The
 * public render path uses the Image block's `render` function with the same
 * `ImageMetadata` value — see puck/config.tsx.
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {value && previewSrc ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt={value.alt}
            style={{
              maxWidth: "100%",
              height: "auto",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
            }}
          />
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            {value.width}×{value.height} · {value.originalExt} · alt: {value.alt || "(none)"}
          </div>
          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: "var(--space-1) var(--space-2)",
              fontSize: "var(--font-size-xs)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
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
          <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-emphasis)" }}>
            Alt text (describe the image for screen readers)
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="e.g. Sarah Chen at the Riverside Theater"
              style={{
                display: "block",
                width: "100%",
                marginTop: "var(--space-1)",
                padding: "var(--space-1) var(--space-2)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-sm)",
              }}
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
