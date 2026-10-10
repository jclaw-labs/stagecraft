/**
 * Inspector-side custom field that lets the artist toggle a block prop
 * between a literal value and a binding to a field on the collection
 * (ADR-009 PR 6).
 *
 * Used by `buildPuckConfig`'s template surfaces — Puck renders this in
 * the block inspector for every prop listed in `BINDABLE_SLOTS`.
 *
 * Two variants:
 *
 *   - <BindableStringPicker>  for `Bindable<string>` (Text content,
 *                             Button text, Link href, RichText text, …).
 *                             Literal mode = text input (a textarea for
 *                             RichText). Binding mode = a dropdown of the
 *                             compatible fields.
 *   - <BindableImagePicker>   for `Bindable<ImageMetadata>` (Image image).
 *                             Literal mode wraps the existing
 *                             `ImagePickerField`. Binding mode = a
 *                             dropdown of image fields.
 *
 * Both take and store the object form (`BindableRef<T>`); the caller
 * wraps a plain literal with `toBindableRef` first. The walker does the
 * resolution.
 */

"use client";

import type { ImageMetadata } from "@/lib/image-types";
import type { BindableRef, FieldDef } from "@/lib/collections";

import { ImagePickerField } from "@/puck/ImagePickerField";

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "literal" | "binding";
  onChange: (next: "literal" | "binding") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        marginBottom: "var(--space-2)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        fontSize: "var(--font-size-xs)",
      }}
      role="group"
      aria-label="Value source"
    >
      <ToggleButton isActive={mode === "literal"} onClick={() => onChange("literal")}>
        Literal
      </ToggleButton>
      <ToggleButton isActive={mode === "binding"} onClick={() => onChange("binding")}>
        From field
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "var(--space-1) var(--space-3)",
        background: isActive ? "var(--color-action)" : "transparent",
        color: isActive ? "var(--color-action-fg)" : "var(--color-text)",
        border: "none",
        cursor: "pointer",
        fontWeight: "var(--font-weight-semibold)" as unknown as number,
      }}
    >
      {children}
    </button>
  );
}

function FieldDropdown({
  value,
  options,
  onChange,
  emptyLabel = "Pick a field…",
}: {
  value: string;
  options: ReadonlyArray<FieldDef>;
  onChange: (fieldId: string) => void;
  emptyLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        fontSize: "var(--font-size-sm)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
      }}
    >
      <option value="">{emptyLabel}</option>
      {options.map((f) => (
        <option key={f.id} value={f.id}>
          {f.key} ({f.type})
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// String picker
// ---------------------------------------------------------------------------

export function BindableStringPicker({
  value,
  onChange,
  stringFields,
  placeholder = "",
  isMultiline = false,
}: {
  value: BindableRef<string>;
  onChange: (next: BindableRef<string>) => void;
  stringFields: ReadonlyArray<FieldDef>;
  placeholder?: string;
  /** Literal mode edits paragraphs in a textarea (RichText). */
  isMultiline?: boolean;
}) {
  const inputStyle = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    fontSize: "var(--font-size-sm)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
  };
  return (
    <div>
      <ModeToggle
        mode={value.kind}
        onChange={(next) => {
          if (next === "literal") onChange({ kind: "literal", value: "" });
          else onChange({ kind: "binding", fieldId: stringFields[0]?.id ?? "" });
        }}
      />
      {value.kind === "literal" && isMultiline ? (
        <textarea
          value={value.value}
          placeholder={placeholder}
          rows={5}
          onChange={(e) => onChange({ kind: "literal", value: e.target.value })}
          style={inputStyle}
        />
      ) : value.kind === "literal" ? (
        <input
          type="text"
          value={value.value}
          placeholder={placeholder}
          onChange={(e) => onChange({ kind: "literal", value: e.target.value })}
          style={inputStyle}
        />
      ) : (
        <FieldDropdown
          value={value.fieldId}
          options={stringFields}
          onChange={(fieldId) => onChange({ kind: "binding", fieldId })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image picker
// ---------------------------------------------------------------------------

export function BindableImagePicker({
  value,
  onChange,
  imageFields,
}: {
  value: BindableRef<ImageMetadata | null>;
  onChange: (next: BindableRef<ImageMetadata | null>) => void;
  imageFields: ReadonlyArray<FieldDef>;
}) {
  return (
    <div>
      <ModeToggle
        mode={value.kind}
        onChange={(next) => {
          if (next === "literal") onChange({ kind: "literal", value: null });
          else onChange({ kind: "binding", fieldId: imageFields[0]?.id ?? "" });
        }}
      />
      {value.kind === "literal" ? (
        <ImagePickerField
          value={value.value}
          onChange={(next) => onChange({ kind: "literal", value: next })}
        />
      ) : (
        <FieldDropdown
          value={value.fieldId}
          options={imageFields}
          onChange={(fieldId) => onChange({ kind: "binding", fieldId })}
        />
      )}
    </div>
  );
}
