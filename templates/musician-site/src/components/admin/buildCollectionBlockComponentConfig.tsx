/**
 * Build the Puck `ComponentConfig` that registers one Collection
 * block on the detail-template editor (ADR-009 §5).
 *
 * One block per existing collection — `TourDatesView`, `PagesView`,
 * etc. The block name is derived from the slug via
 * `blockNameForCollection`; the source collection is fixed in
 * `defaultProps.sourceCollection` so the artist doesn't have to
 * pick it from a dropdown (they already chose the block).
 *
 * Fields:
 *
 *   - `filter`        — custom: `FilterField` (visual clause builder
 *                       per §5.1; collapsible raw-JSON escape hatch
 *                       for shapes the visual UI doesn't surface)
 *   - `sort`          — sortFieldId + direction
 *   - `limit`         — number
 *   - `hideFields`    — array of fieldIds to omit from each iterated
 *                       item's render (UI is a JSON textarea for v1)
 *   - `manage`        — custom: `ManageCollectionLink` (no value;
 *                       renders a navigational affordance)
 *
 * The render function (the inside-editor preview) is a placeholder —
 * the public renderer's `CollectionBlockRender` is the real surface.
 * Inside the editor, the artist sees a labelled placeholder; clicking
 * the "Manage" button takes them to the collection's admin where
 * they can edit items.
 *
 * Two CollectionDefs are passed: `sourceDef` is the collection this
 * block iterates (its fields populate the FilterField's clause field
 * pickers); `currentItemDef` is the collection of the *containing*
 * template (its fields populate the `currentItemField` FilterValue
 * dropdown so the artist can write "where source.artist equals
 * currentItem.id"-style filters).
 */

"use client";

import type { CSSProperties } from "react";
import type { Config, Field } from "@measured/puck";

import { FilterField } from "./FilterField";
import { ManageCollectionLink } from "./ManageCollectionLink";

import type { CollectionDef } from "@/lib/collections/schema";
import { SORTABLE_FIELD_TYPES } from "@/lib/collections/field-classification";
import type { Filter } from "@/lib/collections/filter-schema";

type ComponentConfig = Config["components"][string];

// Puck's `Field<T>` distributes badly through generic helpers; cast
// at the registration site, same pattern as buildEditorPuckConfig.
type AnyField = Field<unknown>;

export function buildCollectionBlockComponentConfig(
  sourceDef: CollectionDef,
  currentItemDef: CollectionDef,
): ComponentConfig {
  const sortableFields = sourceDef.fields.filter((f) => SORTABLE_FIELD_TYPES.has(f.type));

  const filterField: AnyField = {
    type: "custom",
    label: "Filter",
    render: ({ value, onChange }) => (
      <FilterField
        value={(value as Filter | null | undefined) ?? null}
        onChange={onChange}
        sourceDef={sourceDef}
        currentItemDef={currentItemDef}
      />
    ),
  };

  const manageField: AnyField = {
    type: "custom",
    label: "Manage",
    render: () => (
      <ManageCollectionLink
        collectionSlug={sourceDef.slug}
        pluralName={sourceDef.pluralName}
      />
    ),
  };

  const hideFieldsField: AnyField = {
    type: "custom",
    label: "Hide fields",
    render: ({ value, onChange }) => (
      <HideFieldsField
        value={(value as string[] | undefined) ?? []}
        onChange={onChange}
        fields={sourceDef.fields.map((f) => ({ id: f.id, key: f.key }))}
      />
    ),
  };

  return {
    fields: {
      manage: manageField,
      filter: filterField,
      sort: {
        type: "object" as const,
        label: "Sort",
        objectFields: {
          fieldId: {
            type: "select" as const,
            options: [
              { label: "(no sort)", value: "" },
              ...sortableFields.map((f) => ({ label: f.key, value: f.id })),
            ],
          },
          direction: {
            type: "select" as const,
            options: [
              { label: "Ascending", value: "asc" },
              { label: "Descending", value: "desc" },
            ],
          },
        },
      },
      limit: { type: "number" as const, label: "Limit", min: 0 },
      hideFields: hideFieldsField,
    },
    defaultProps: {
      sourceCollection: sourceDef.slug,
      filter: null,
      sort: null,
      limit: null,
      hideFields: [],
    },
    render: ({ filter, limit }) => (
      <EditorPreview
        pluralName={sourceDef.pluralName}
        hasFilter={filter !== null && filter !== undefined}
        limit={typeof limit === "number" ? limit : null}
      />
    ),
  };
}

function EditorPreview({
  pluralName,
  hasFilter,
  limit,
}: {
  pluralName: string;
  hasFilter: boolean;
  limit: number | null;
}) {
  return (
    <div style={previewStyle}>
      <strong style={{ fontSize: "var(--font-size-sm)" }}>
        Collection: {pluralName}
      </strong>
      <p style={previewHintStyle}>
        Renders each item through this collection&apos;s item template.
        {hasFilter ? " Filter applied." : " No filter — every item."}
        {limit !== null && limit > 0 ? ` Limit: ${limit}.` : ""}
      </p>
    </div>
  );
}

function HideFieldsField({
  value,
  onChange,
  fields,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  fields: Array<{ id: string; key: string }>;
}) {
  // Checkbox list. The artist toggles which fields the iterated
  // items should NOT render. A future clause builder might fold
  // this into the item template's own rendering, but for v1 it's a
  // useful per-block override.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {fields.map((f) => {
        const checked = value.includes(f.id);
        return (
          <label
            key={f.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                if (e.target.checked) onChange([...value, f.id]);
                else onChange(value.filter((v) => v !== f.id));
              }}
            />
            {f.key}
          </label>
        );
      })}
    </div>
  );
}

const previewStyle: CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  background: "var(--color-surface-raised)",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
};

const previewHintStyle: CSSProperties = {
  margin: "var(--space-1) 0 0",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};
