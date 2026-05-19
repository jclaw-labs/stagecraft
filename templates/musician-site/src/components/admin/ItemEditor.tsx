/**
 * Generic item editor for the collection abstraction (ADR-009 PR 4).
 *
 * Reads a `CollectionDef` and renders the appropriate input per field
 * type. The component is purely presentational — state lives in the
 * surrounding `useItemForm` hook (sibling file), the save call goes
 * through `/api/collections/<slug>/items/<itemSlug>`.
 *
 * Out of scope here:
 *   - `puckContent` fields render a "Edit body in Puck →" button rather
 *     than embedding the editor. PR 6 wires the binding-aware Puck
 *     template editor; until then the existing /admin/pages/<slug>
 *     route stays the canonical puckContent surface.
 *   - `richText` renders a plain textarea for now. PR 6 swaps in the
 *     Tiptap-based editor.
 *   - `collectionRef` and `multiCollectionRef` only render when the
 *     editor is mounted with the target collection's items pre-fetched
 *     (via the `referenceOptions` prop). The wrapper route handles the
 *     fetch.
 *
 * The editor is intentionally dumb about field config (maxLength,
 * min/max, options, etc.) at the UI layer; runtime validation happens
 * on save via the dynamic Zod schema built from `def.fields`. The UI
 * layer mostly enforces required-ness with the HTML5 `required` flag.
 */

"use client";

import Link from "next/link";
import {
  CheckboxField,
  ColorField,
  DateField,
  Field,
  MultiCollectionRefField,
  MultiSelectField,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/admin/form";
import { ImagePickerField } from "@/puck/ImagePickerField";

import type {
  CollectionDef,
  FieldDef,
  FieldValue,
  Item,
} from "@/lib/collections";

export type ReferenceOptions = Record<
  string /* targetCollectionSlug */,
  Array<{ id: string; label: string }>
>;

export type ItemEditorProps = {
  def: CollectionDef;
  /**
   * The item being edited. Pass a "draft" item (default values populated)
   * for the create-new flow.
   */
  item: Item;
  /** Fires on every field change with the next item. */
  onChange: (next: Item) => void;
  /**
   * Items from every collection referenced by any `collectionRef` /
   * `multiCollectionRef` field on this def. Pre-fetched by the wrapper
   * route so the form doesn't need to hit the network mid-edit.
   */
  referenceOptions?: ReferenceOptions;
};

export function ItemEditor({ def, item, onChange, referenceOptions = {} }: ItemEditorProps) {
  const setFieldValue = (fieldId: string, value: FieldValue | undefined) => {
    const next = { ...item, values: { ...item.values } };
    if (value === undefined) delete next.values[fieldId];
    else next.values[fieldId] = value;
    onChange(next);
  };

  // Field-order matches the def. The schema editor (PR 5) is the place
  // to reorder; here we render in declaration order.
  return (
    <div>
      {def.fields.map((field) => (
        <FieldRenderer
          key={field.id}
          def={def}
          field={field}
          item={item}
          referenceOptions={referenceOptions}
          onChange={(v) => setFieldValue(field.id, v)}
        />
      ))}
    </div>
  );
}

function FieldRenderer({
  field,
  item,
  referenceOptions,
  onChange,
}: {
  def: CollectionDef;
  field: FieldDef;
  item: Item;
  referenceOptions: ReferenceOptions;
  onChange: (next: FieldValue | undefined) => void;
}) {
  const current = item.values[field.id];

  // Exhaustive switch — TypeScript will complain when a new field type
  // is added to the discriminated union and we forget to handle it.
  switch (field.type) {
    case "text":
      return (
        <TextField
          label={field.key}
          isRequired={field.required}
          value={current?.type === "text" ? current.value : ""}
          onChange={(v) => onChange(v === "" ? undefined : { type: "text", value: v })}
        />
      );
    case "longText":
      return (
        <TextareaField
          label={field.key}
          isRequired={field.required}
          value={current?.type === "longText" ? current.value : ""}
          onChange={(v) => onChange(v === "" ? undefined : { type: "longText", value: v })}
        />
      );
    case "richText":
      // Stub: render as a textarea showing a JSON dump until PR 6 wires
      // in the Tiptap editor. Editing the JSON is technically possible
      // but discouraged — most artists won't touch this until the
      // proper editor ships.
      return (
        <TextareaField
          label={field.key}
          description="Rich-text editor lands in PR 6; for now this field shows raw Tiptap JSON."
          isRequired={field.required}
          value={current?.type === "richText" ? JSON.stringify(current.value, null, 2) : ""}
          onChange={(v) => {
            if (v === "") return onChange(undefined);
            try {
              const parsed = JSON.parse(v) as { type: "doc"; content?: unknown[] };
              onChange({ type: "richText", value: parsed });
            } catch {
              // Ignore — the saved value stays untouched until the
              // textarea contains valid JSON. The save button will be
              // gated on form validity in a future iteration.
            }
          }}
        />
      );
    case "number":
      return (
        <NumberField
          label={field.key}
          // Default to the field's `min` if set — defaulting to 0 when
          // `min > 0` makes every new item's first save fail validation
          // with a generic "value must be ≥ min" message.
          value={current?.type === "number" ? current.value : field.min ?? 0}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(v) => onChange({ type: "number", value: v })}
        />
      );
    case "boolean":
      return (
        <CheckboxField
          label={field.key}
          value={current?.type === "boolean" ? current.value : field.default ?? false}
          onChange={(v) => onChange({ type: "boolean", value: v })}
        />
      );
    case "select":
      return (
        <SelectField
          label={field.key}
          value={(current?.type === "select" ? current.value : field.options[0]?.value) ?? ""}
          options={field.options.map((opt) => ({ label: opt.label, value: opt.value }))}
          onChange={(v) => onChange({ type: "select", value: v })}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectField
          label={field.key}
          value={current?.type === "multiSelect" ? current.value : []}
          options={field.options.map((opt) => ({ label: opt.label, value: opt.value }))}
          onChange={(v) => onChange({ type: "multiSelect", value: v })}
        />
      );
    case "date":
      return (
        <DateField
          label={field.key}
          isRequired={field.required}
          includeTime={field.includeTime}
          value={current?.type === "date" ? current.value : ""}
          onChange={(v) => onChange(v === "" ? undefined : { type: "date", value: v })}
        />
      );
    case "url":
      return (
        <TextField
          label={field.key}
          type="url"
          isRequired={field.required}
          value={current?.type === "url" ? current.value : ""}
          onChange={(v) => onChange(v === "" ? undefined : { type: "url", value: v })}
        />
      );
    case "email":
      return (
        <TextField
          label={field.key}
          type="email"
          isRequired={field.required}
          value={current?.type === "email" ? current.value : ""}
          onChange={(v) => onChange(v === "" ? undefined : { type: "email", value: v })}
        />
      );
    case "color":
      return (
        <ColorField
          label={field.key}
          value={current?.type === "color" ? current.value : ""}
          isOptional={!field.required}
          onChange={(v) => onChange(v === "" ? undefined : { type: "color", value: v })}
        />
      );
    case "image":
      return (
        <Field label={field.key}>
          <ImagePickerField
            value={current?.type === "image" ? current.value : null}
            onChange={(next) =>
              onChange(
                next === null
                  ? undefined
                  : { type: "image", value: next as Extract<FieldValue, { type: "image" }>["value"] },
              )
            }
          />
        </Field>
      );
    case "file":
      // No file-upload primitive yet — PR 6 lands a richer asset picker.
      // For now, accept a manual path entry so the artist can at least
      // wire up a file they've placed under public/ themselves.
      return (
        <TextField
          label={field.key}
          description="Manual file path for v1; a proper upload picker lands later."
          isRequired={field.required}
          value={current?.type === "file" ? current.value.src : ""}
          onChange={(v) =>
            onChange(
              v === ""
                ? undefined
                : {
                    type: "file",
                    value: { src: v, mimeType: "application/octet-stream", originalName: v, sizeBytes: 0 },
                  },
            )
          }
        />
      );
    case "collectionRef": {
      const options = referenceOptions[field.targetCollection] ?? [];
      const value = current?.type === "collectionRef" ? current.value.itemId : "";
      return (
        <SelectField
          label={field.key}
          value={value}
          options={[
            { label: "(none)", value: "" },
            ...options.map((opt) => ({ label: opt.label, value: opt.id })),
          ]}
          onChange={(v) =>
            onChange(v === "" ? undefined : { type: "collectionRef", value: { itemId: v } })
          }
        />
      );
    }
    case "multiCollectionRef": {
      const options = referenceOptions[field.targetCollection] ?? [];
      return (
        <MultiCollectionRefField
          label={field.key}
          value={current?.type === "multiCollectionRef" ? current.value : []}
          options={options.map((opt) => ({ id: opt.id, label: opt.label }))}
          onChange={(v) => onChange({ type: "multiCollectionRef", value: v })}
        />
      );
    }
    case "puckContent":
      // PR 6 lands the embedded template editor. Until then we link out
      // to the existing per-page Puck route, which only works for the
      // Pages collection — for other collections the link is a no-op
      // placeholder.
      return (
        <Field
          label={field.key}
          description="Edit the body in Puck. Embedded editor lands in PR 6."
        >
          {item.slug && item.slug !== "_singleton" ? (
            <Link
              href={`/admin/pages/${item.slug}`}
              style={{
                display: "inline-block",
                padding: "var(--space-2) var(--space-4)",
                background: "var(--color-surface-raised)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text)",
                textDecoration: "none",
                fontSize: "var(--font-size-sm)",
              }}
            >
              Edit body in Puck →
            </Link>
          ) : (
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
              The puckContent editor isn&apos;t wired up for this collection yet.
            </p>
          )}
        </Field>
      );
    default: {
      // Exhaustiveness check — TS errors here if a new field type
      // sneaks into the discriminated union without a case above.
      const _exhaustive: never = field;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Build a default item for a new entry in this collection. Used by
 * the "new item" flow; the editor wraps an empty values map.
 *
 * Required scalar fields get a sensible empty/zero default; optional
 * fields are omitted (the editor populates them when the artist
 * starts typing).
 */
export function defaultItemValues(def: CollectionDef): Item["values"] {
  const values: Item["values"] = {};
  for (const field of def.fields) {
    const v = defaultValueFor(field);
    if (v !== undefined) values[field.id] = v;
  }
  return values;
}

function defaultValueFor(field: FieldDef): FieldValue | undefined {
  switch (field.type) {
    case "boolean":
      return { type: "boolean", value: field.default ?? false };
    case "select":
      return field.options[0]
        ? { type: "select", value: field.options[0].value }
        : undefined;
    case "multiSelect":
      return { type: "multiSelect", value: [] };
    case "multiCollectionRef":
      return { type: "multiCollectionRef", value: [] };
    case "puckContent":
      return { type: "puckContent", value: { content: [], root: { props: {} } } as never };
    // Required scalar types get an empty value so the dynamic Zod
    // schema can fall back to the right error message; optional ones
    // are simply absent from the initial draft.
    case "text":
    case "longText":
      return field.required ? { type: field.type, value: "" } : undefined;
    case "richText":
      return field.required
        ? { type: "richText", value: { type: "doc", content: [] } }
        : undefined;
    case "number":
      // Default to `min` when set, otherwise 0 — see the NumberField
      // case in FieldRenderer for the rationale.
      return field.required ? { type: "number", value: field.min ?? 0 } : undefined;
    case "date":
    case "url":
    case "email":
    case "color":
      return field.required ? { type: field.type, value: "" } : undefined;
    case "image":
    case "file":
    case "collectionRef":
      // No sensible empty default for these — leave absent until the
      // artist picks one.
      return undefined;
    default: {
      const _exhaustive: never = field;
      void _exhaustive;
      return undefined;
    }
  }
}
