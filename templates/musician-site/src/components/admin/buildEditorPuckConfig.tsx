/**
 * Build a Puck `Config` for the template editor (ADR-009 PR 6).
 *
 * Takes the collection whose template is being edited and returns a
 * Puck config whose blocks expose:
 *
 *   - Bindable props (`Text.content`, `Image.src`, `Button.label`, …)
 *     as `BindablePicker` custom fields. The persisted shape is
 *     `Bindable<T>` so the public renderer (PR 2) can resolve it
 *     against the current item.
 *   - Plain props (variants, alignment, padding) as native Puck
 *     selects.
 *   - Slot fields (`Section.children`, `Stack.children`) as native
 *     Puck slots so drag-and-drop into containers Just Works.
 *
 * The rendered component inside the editor is a thin preview shim —
 * literals show as-is, bindings show as a placeholder dotted box so
 * the artist can see the structure without needing the binding to
 * resolve. The shim is editor-only; the public renderer (PR 2) is
 * the source of truth at deploy time.
 */

"use client";

import type { Config, Field } from "@measured/puck";

import {
  BINDABLE_SLOTS,
  RICH_FIELDS,
  getCollectionContextForEditor,
} from "@/lib/collections/template/editor-config";
import {
  SECTION_PADDINGS,
  SECTION_WIDTHS,
  STACK_ALIGNMENTS,
  STACK_DIRECTIONS,
  STACK_GAPS,
  STACK_JUSTIFICATIONS,
  TEXT_ALIGNS,
  TEXT_VARIANTS,
  BUTTON_VARIANTS,
} from "@/lib/collections/template/primitives";

import type { Bindable, CollectionDef, FieldDef } from "@/lib/collections";
import type { ImageMetadata } from "@/lib/image-types";

// Puck's `Field<T>` distributes badly through generic helper signatures
// (it collapses to `ArrayField<never>`). The custom-field render does
// take ownership of the concrete value shape, so we cast back to a
// `Field<unknown>` at the registration site below.
type AnyField = Field<unknown>;

import {
  BindableImagePicker,
  BindableStringPicker,
  FieldIdPicker,
} from "./BindablePicker";

// ---------------------------------------------------------------------------
// Custom-field factory helpers
// ---------------------------------------------------------------------------

function bindableStringField(
  stringFields: ReadonlyArray<FieldDef>,
  description?: string,
): AnyField {
  return {
    type: "custom",
    label: description,
    render: ({ value, onChange }) => (
      <BindableStringPicker
        value={(value as Bindable<string> | undefined) ?? { kind: "literal", value: "" }}
        onChange={onChange}
        stringFields={stringFields}
      />
    ),
  } as AnyField;
}

function bindableImageField(
  imageFields: ReadonlyArray<FieldDef>,
  description?: string,
): AnyField {
  return {
    type: "custom",
    label: description,
    render: ({ value, onChange }) => (
      <BindableImagePicker
        value={
          (value as Bindable<ImageMetadata | null> | undefined) ??
          { kind: "literal", value: null }
        }
        onChange={onChange}
        imageFields={imageFields}
      />
    ),
  } as AnyField;
}

function fieldIdField(
  candidates: ReadonlyArray<FieldDef>,
  description?: string,
): AnyField {
  return {
    type: "custom",
    label: description,
    render: ({ value, onChange }) => (
      <FieldIdPicker
        value={(value as string | undefined) ?? ""}
        onChange={onChange}
        fields={candidates}
      />
    ),
  } as AnyField;
}

// ---------------------------------------------------------------------------
// Editor preview components
//
// These are *not* the public renderer. They give the artist enough
// signal to navigate the structure: literals render at face value;
// bindings render as a dotted-outline placeholder showing the field
// key. The walker (PR 2) handles the real thing at deploy time.
// ---------------------------------------------------------------------------

function bindingPlaceholder(fieldId: string, fields: ReadonlyArray<FieldDef>): string {
  const field = fields.find((f) => f.id === fieldId);
  return field ? `{${field.key}}` : "{ ??? }";
}

function previewBindable<T>(
  value: Bindable<T> | undefined,
  fields: ReadonlyArray<FieldDef>,
  literalToString: (v: T) => string,
): { display: string; isBinding: boolean } {
  if (value === undefined) return { display: "", isBinding: false };
  if (value.kind === "binding") {
    return { display: bindingPlaceholder(value.fieldId, fields), isBinding: true };
  }
  return { display: literalToString(value.value), isBinding: false };
}

const placeholderStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "var(--space-1) var(--space-2)",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "var(--font-mono)",
};

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

export function buildEditorPuckConfig(def: CollectionDef): Config {
  const ctx = getCollectionContextForEditor(def);

  const Text: Config["components"][string] = {
    fields: {
      content: bindableStringField(
        ctx.stringFields,
        BINDABLE_SLOTS.Text.content.description,
      ),
      variant: {
        type: "select",
        options: TEXT_VARIANTS.map((v) => ({ label: v, value: v })),
      },
      align: {
        type: "select",
        options: TEXT_ALIGNS.map((a) => ({ label: a, value: a })),
      },
    },
    defaultProps: {
      content: { kind: "literal", value: "Text" },
      variant: "body",
      align: "start",
    },
    render: ({ content, variant, align }) => {
      const preview = previewBindable<string>(content, ctx.stringFields, (s) => s);
      return (
        <p
          style={{
            fontSize: variant === "lead" ? "var(--font-size-lg)" : "var(--font-size-base)",
            textAlign: align as React.CSSProperties["textAlign"],
            margin: 0,
          }}
        >
          {preview.isBinding ? (
            <span style={placeholderStyle}>{preview.display}</span>
          ) : (
            preview.display || <span style={placeholderStyle}>{"{empty}"}</span>
          )}
        </p>
      );
    },
  };

  const Image: Config["components"][string] = {
    fields: {
      src: bindableImageField(ctx.imageFields, BINDABLE_SLOTS.Image.src.description),
      altOverride: bindableStringField(
        ctx.stringFields,
        BINDABLE_SLOTS.Image.altOverride.description,
      ),
    },
    defaultProps: {
      src: { kind: "literal", value: null },
      altOverride: { kind: "literal", value: "" },
    },
    render: ({ src }) => {
      if (src && src.kind === "binding") {
        return (
          <span style={placeholderStyle}>
            image: {bindingPlaceholder(src.fieldId, ctx.imageFields)}
          </span>
        );
      }
      if (src && src.kind === "literal" && src.value) {
        return (
          <span style={placeholderStyle}>image: {src.value.alt || "(no alt)"}</span>
        );
      }
      return <span style={placeholderStyle}>image: (none)</span>;
    },
  };

  const Button: Config["components"][string] = {
    fields: {
      label: bindableStringField(ctx.stringFields),
      href: bindableStringField(ctx.stringFields),
      variant: {
        type: "select",
        options: BUTTON_VARIANTS.map((v) => ({ label: v, value: v })),
      },
    },
    defaultProps: {
      label: { kind: "literal", value: "Click me" },
      href: { kind: "literal", value: "#" },
      variant: "primary",
    },
    render: ({ label, variant }) => {
      const preview = previewBindable<string>(label, ctx.stringFields, (s) => s);
      return (
        <span
          style={{
            display: "inline-block",
            padding: "var(--space-1) var(--space-3)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "var(--radius-sm)",
            background: variant === "primary" ? "var(--color-action)" : "transparent",
            color: variant === "primary" ? "var(--color-action-fg)" : "var(--color-text)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {preview.display || "Button"}
        </span>
      );
    },
  };

  const Link: Config["components"][string] = {
    fields: {
      label: bindableStringField(ctx.stringFields),
      href: bindableStringField(ctx.stringFields),
    },
    defaultProps: {
      label: { kind: "literal", value: "Link" },
      href: { kind: "literal", value: "#" },
    },
    render: ({ label }) => {
      const preview = previewBindable<string>(label, ctx.stringFields, (s) => s);
      return <a style={{ color: "var(--color-action)" }}>{preview.display || "link"}</a>;
    },
  };

  const RichTextRender: Config["components"][string] = {
    fields: {
      field: fieldIdField(
        ctx.richTextFields,
        RICH_FIELDS.RichTextRender.field.description,
      ),
    },
    defaultProps: { field: ctx.richTextFields[0]?.id ?? "" },
    render: ({ field }) => (
      <span style={placeholderStyle}>
        rich text: {bindingPlaceholder(field as string, ctx.richTextFields)}
      </span>
    ),
  };

  const Section: Config["components"][string] = {
    fields: {
      width: {
        type: "select",
        options: SECTION_WIDTHS.map((v) => ({ label: v, value: v })),
      },
      padding: {
        type: "select",
        options: SECTION_PADDINGS.map((v) => ({ label: v, value: v })),
      },
      children: { type: "slot" },
    },
    defaultProps: { width: "default", padding: "default", children: [] },
    render: ({ width, children: Children }) => (
      <section
        style={{
          maxWidth: width === "narrow" ? "var(--max-width-narrow)" : "var(--max-width-content)",
          margin: "0 auto",
          padding: "var(--space-4)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <Children />
      </section>
    ),
  };

  const Stack: Config["components"][string] = {
    fields: {
      direction: {
        type: "select",
        options: STACK_DIRECTIONS.map((v) => ({ label: v, value: v })),
      },
      gap: {
        type: "select",
        options: STACK_GAPS.map((v) => ({ label: v, value: v })),
      },
      align: {
        type: "select",
        options: STACK_ALIGNMENTS.map((v) => ({ label: v, value: v })),
      },
      justify: {
        type: "select",
        options: STACK_JUSTIFICATIONS.map((v) => ({ label: v, value: v })),
      },
      children: { type: "slot" },
    },
    defaultProps: {
      direction: "vertical",
      gap: "default",
      align: "stretch",
      justify: "start",
      children: [],
    },
    render: ({ direction, gap, children: Children }) => (
      <div
        style={{
          display: "flex",
          flexDirection: direction === "vertical" ? "column" : "row",
          gap:
            gap === "large"
              ? "var(--space-8)"
              : gap === "small"
                ? "var(--space-2)"
                : "var(--space-4)",
          padding: "var(--space-2)",
          border: "1px dashed var(--color-border)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <Children />
      </div>
    ),
  };

  return {
    components: { Section, Stack, Text, Image, Button, Link, RichTextRender },
    root: { fields: {} },
  };
}
