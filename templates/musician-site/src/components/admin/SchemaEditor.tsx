/**
 * Schema editor for one Collection (ADR-009 PR 5).
 *
 * Edits the `CollectionDef` directly — fields list, identity (singular
 * / plural names), routing (`detailUrlPrefix`), ordering
 * (`defaultSort`), and `slugSourceFieldId`. The component is purely
 * presentational; state and the save call live in
 * `SchemaEditorClient` (sibling).
 *
 * Field-level destructive operations route through the parent. The
 * confirm flow for "remove a field with N items' worth of data" is the
 * caller's job; this layer only signals intent via the issue/warning
 * list the API route returns.
 *
 * Out of scope for this PR:
 *   - Reordering fields. ADR §11 calls this out; the next iteration
 *     adds drag-and-drop. Today the order in the JSON wins.
 *   - Adding `puckContent` / image / file fields. The form has the
 *     surface but no extra per-type config UI; defaults are
 *     reasonable.
 *   - Selecting per-collection templates (itemTemplate /
 *     detailTemplate / listTemplate). Lives in PR 6.
 */

"use client";

import {
  CheckboxField,
  Field,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/form";
import type {
  CollectionDef,
  FieldDef,
  FieldType,
  SelectOption,
} from "@/lib/collections";
// Direct from the field-classification submodule — node-import-free
// so this client component doesn't drag schema.ts's node:crypto into
// the browser bundle.
import {
  FIELD_TYPE_OPTIONS,
  SLUG_SOURCE_COMPATIBLE_TYPES,
  SORTABLE_FIELD_TYPES,
} from "@/lib/collections/field-classification";
// Node-import-free like field-classification: declares which fields the
// public specialised card views (tour dates, releases, …) depend on.
import {
  describeViewFieldImpact,
  describeViewFieldProblem,
  viewFieldImpact,
  viewFieldProblems,
} from "@/lib/collections/template/view-requirements";

/**
 * Client-side field-id generator. Mirrors `generateFieldId` from
 * `@/lib/collections/schema` but uses the browser's Web Crypto so
 * importing this client module doesn't transitively pull `node:crypto`
 * (and the `store.ts` → `fs-helpers.ts` chain) into the bundle.
 */
function newFieldId(): string {
  return `fld_${crypto.randomUUID()}`;
}

// Field-type labels (`FIELD_TYPE_OPTIONS`) and the slug-source /
// sortable sets all come from `field-classification` so the editor's
// dropdowns can't drift from `collectionDefSchema`'s superRefine check
// or from the specialised-view warnings' copy.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SchemaEditorIssue = {
  kind: string;
  fieldId?: string;
  fieldKey?: string;
  message: string;
};

export type SchemaEditorWarning = {
  kind: string;
  fieldId?: string;
  fieldKey?: string;
  message: string;
};

export type SchemaEditorProps = {
  def: CollectionDef;
  onChange: (next: CollectionDef) => void;
  /** Server-reported blocking issues from the last save attempt. */
  issues?: SchemaEditorIssue[];
  /** Server-reported non-blocking warnings from the last save attempt. */
  warnings?: SchemaEditorWarning[];
  /**
   * The schema as last saved. The save API checks type changes against
   * it, so the view warnings do too. Defaults to `def` (no unsaved edits).
   */
  savedDef?: CollectionDef;
};

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function SchemaEditor({
  def,
  onChange,
  issues = [],
  warnings = [],
  savedDef = def,
}: SchemaEditorProps) {
  const updateField = (fieldId: string, next: FieldDef | null) => {
    if (next === null) {
      onChange({ ...def, fields: def.fields.filter((f) => f.id !== fieldId) });
    } else {
      onChange({
        ...def,
        fields: def.fields.map((f) => (f.id === fieldId ? next : f)),
      });
    }
  };

  const addField = (type: FieldType) => {
    const newField = makeDefaultField(type, def.fields);
    onChange({ ...def, fields: [...def.fields, newField] });
  };

  // Fields the collection's public card view (tour dates, releases, …)
  // depends on but that the current draft removed or retyped. Shown in
  // the same heads-up as the server's save warnings, so the consequence
  // stays visible after the confirm prompt is dismissed.
  const viewProblems: SchemaEditorWarning[] = viewFieldProblems(def, savedDef).map((problem) => ({
    kind: "specialised-view-field",
    fieldId: problem.field?.id ?? problem.requirement.fieldId,
    message: describeViewFieldProblem(def, problem),
  }));
  const headsUp = [...warnings, ...viewProblems];

  const slugSourceOptions = [
    { label: "(none — items use a slug they pick themselves)", value: "" },
    ...def.fields
      .filter((f) => SLUG_SOURCE_COMPATIBLE_TYPES.has(f.type))
      .map((f) => ({ label: f.key, value: f.id })),
  ];

  return (
    <div>
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Identity</h2>
        <TextField
          label="Singular name"
          description="What one entry is called (e.g. “Tour Date”)."
          value={def.singularName}
          onChange={(v) => onChange({ ...def, singularName: v })}
        />
        <TextField
          label="Plural name"
          description="What a list of entries is called (e.g. “Tour Dates”)."
          value={def.pluralName}
          onChange={(v) => onChange({ ...def, pluralName: v })}
        />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Fields</h2>
        {issues.length > 0 ? (
          <IssueList kind="error" entries={issues} />
        ) : null}
        {headsUp.length > 0 ? (
          <IssueList kind="warning" entries={headsUp} />
        ) : null}
        {def.fields.map((field) => (
          <FieldEditor
            key={field.id}
            def={def}
            savedDef={savedDef}
            field={field}
            isInUse={def.slugSourceFieldId === field.id}
            onChange={(next) => updateField(field.id, next)}
          />
        ))}
        <AddFieldRow onAdd={addField} />
      </section>

      {def.isSingleton ? null : (
        <section style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>Routing & ordering</h2>
          <SelectField
            label="Slug source"
            description="Field used to derive an item's URL slug. If unset, the slug is whatever the editor picks at create time."
            value={def.slugSourceFieldId ?? ""}
            options={slugSourceOptions}
            onChange={(v) => onChange({ ...def, slugSourceFieldId: v === "" ? null : v })}
          />
          <TextField
            label="Detail URL prefix"
            description="Path prefix for per-item detail pages (e.g. “/tour-dates”). Leave blank for collections with no detail pages."
            value={def.detailUrlPrefix ?? ""}
            onChange={(v) => onChange({ ...def, detailUrlPrefix: v === "" ? null : v })}
          />
          <DefaultSortEditor def={def} onChange={onChange} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-field row
// ---------------------------------------------------------------------------

function FieldEditor({
  def,
  savedDef,
  field,
  isInUse,
  onChange,
}: {
  /** The collection being edited — its slug picks the public card view to warn about. */
  def: CollectionDef;
  /** The collection as last saved. */
  savedDef: CollectionDef;
  field: FieldDef;
  /** True when the def uses this field as `slugSourceFieldId`. */
  isInUse: boolean;
  onChange: (next: FieldDef | null) => void;
}) {
  const isLocked = field.systemLocked ?? false;
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        marginBottom: "var(--space-3)",
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-2)",
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
          <strong>{field.key}</strong>
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {field.type}
          </span>
          {isLocked ? <Pill>system-locked</Pill> : null}
          {isInUse ? <Pill>slug source</Pill> : null}
        </div>
        {isLocked ? null : (
          <button
            type="button"
            onClick={() => {
              if (confirm(removeFieldPrompt(def, field, isInUse, savedDef))) {
                onChange(null);
              }
            }}
            style={{
              padding: "var(--space-1) var(--space-2)",
              background: "transparent",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-xs)",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        )}
      </div>

      <TextField
        label="Name"
        description="The field's display name. Renamed freely without affecting stored values."
        value={field.key}
        onChange={(v) => onChange({ ...field, key: v })}
        isRequired
      />

      <TypeSelector
        field={field}
        onChange={(next) => {
          // Retyping a field the public card view reads to a type it
          // can't render: confirm first. Cancelling leaves the
          // (controlled) select on the old type. A retype the save API
          // blocks gets no prompt; its save error explains it. Nor does
          // one the heads-up already reports.
          const savedField = savedDef.fields.find((f) => f.id === field.id);
          const impact = viewFieldImpact(
            def,
            field.id,
            {
              kind: "retype",
              // A field added in this draft has no saved type to convert
              // from, so any type saves.
              from: savedField?.type ?? next.type,
              to: next.type,
            },
            savedDef,
          );
          if (impact && !confirm(describeViewFieldImpact(impact, field.key))) return;
          onChange(next);
        }}
      />

      <RequiredToggle field={field} onChange={onChange} />

      <PerTypeConfig field={field} onChange={onChange} />
    </div>
  );
}

/**
 * Confirm-dialog copy for removing `field`. Mentions the slug-source use
 * and, when the collection's public card view reads the field, what the
 * removal does to it (falls back to the default card / hides a piece),
 * unless the draft has already broken that piece. `savedDef` is the
 * schema as last saved.
 */
export function removeFieldPrompt(
  def: Pick<CollectionDef, "slug" | "fields">,
  field: Pick<FieldDef, "id" | "key">,
  isSlugSource: boolean,
  savedDef: Pick<CollectionDef, "fields"> = def,
): string {
  const impact = viewFieldImpact(def, field.id, { kind: "remove" }, savedDef);
  const slugNote = `"${field.key}" is currently used as the slug source.`;
  if (impact) {
    const viewNote = describeViewFieldImpact(impact, field.key);
    return isSlugSource ? `${slugNote} ${viewNote}` : viewNote;
  }
  return isSlugSource ? `${slugNote} Remove anyway?` : `Remove field "${field.key}"?`;
}

// ---------------------------------------------------------------------------
// Per-field controls
// ---------------------------------------------------------------------------

function TypeSelector({
  field,
  onChange,
}: {
  field: FieldDef;
  onChange: (next: FieldDef) => void;
}) {
  // A locked field can't change type at all. An unlocked field can
  // *technically* change to anything; the API blocks lossy transitions
  // on save. We render the full list so the artist sees the option,
  // and they get a clear server-side error if they try a lossy one.
  if (field.systemLocked) {
    return (
      <Field label="Type" description="System-locked — type can't change.">
        <input
          type="text"
          value={field.type}
          disabled
          style={disabledInputStyle}
        />
      </Field>
    );
  }
  return (
    <SelectField
      label="Type"
      description="Lossy type changes (e.g. text → image) are blocked on save."
      value={field.type}
      options={FIELD_TYPE_OPTIONS}
      onChange={(nextType) => onChange(changeFieldType(field, nextType))}
    />
  );
}

function RequiredToggle({
  field,
  onChange,
}: {
  field: FieldDef;
  onChange: (next: FieldDef | null) => void;
}) {
  // Some variants don't carry a `required` flag at all.
  if (
    field.type === "boolean" ||
    field.type === "multiSelect" ||
    field.type === "multiCollectionRef" ||
    field.type === "puckContent"
  ) {
    return null;
  }
  if (field.systemLocked) {
    return (
      <Field label="Required" description="System-locked — can't toggle required.">
        <input
          type="text"
          value={field.required ? "yes" : "no"}
          disabled
          style={disabledInputStyle}
        />
      </Field>
    );
  }
  return (
    <CheckboxField
      label="Required"
      description="Items without a value for this field will fail validation."
      value={field.required}
      onChange={(v) => onChange({ ...field, required: v })}
    />
  );
}

function PerTypeConfig({
  field,
  onChange,
}: {
  field: FieldDef;
  onChange: (next: FieldDef) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <NumberField
          label="Max length"
          description="Leave blank for no limit."
          value={field.maxLength ?? 0}
          onChange={(v) => onChange({ ...field, maxLength: v > 0 ? v : undefined })}
        />
      );
    case "number":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
          <NumberField
            label="Min"
            value={field.min ?? 0}
            onChange={(v) => onChange({ ...field, min: v })}
          />
          <NumberField
            label="Max"
            value={field.max ?? 0}
            onChange={(v) => onChange({ ...field, max: v })}
          />
          <NumberField
            label="Step"
            value={field.step ?? 1}
            onChange={(v) => onChange({ ...field, step: v > 0 ? v : 1 })}
          />
        </div>
      );
    case "select":
    case "multiSelect":
      return <OptionsEditor field={field} onChange={onChange} />;
    case "date":
      return (
        <CheckboxField
          label="Include time"
          description="When checked, the field stores a full datetime instead of just a date."
          value={field.includeTime ?? false}
          onChange={(v) => onChange({ ...field, includeTime: v })}
        />
      );
    case "boolean":
      return (
        <CheckboxField
          label="Default to yes"
          description="Value used when an item omits the field."
          value={field.default ?? false}
          onChange={(v) => onChange({ ...field, default: v })}
        />
      );
    case "collectionRef":
    case "multiCollectionRef":
      return (
        <TextField
          label="Target collection slug"
          description="Slug of the collection items reference."
          value={field.targetCollection}
          onChange={(v) => onChange({ ...field, targetCollection: v })}
        />
      );
    case "file":
      return (
        <TextField
          label="MIME filter"
          description="Comma-separated MIME types (e.g. “audio/*, application/pdf”). Blank = no filter."
          value={field.mimeFilter?.join(", ") ?? ""}
          onChange={(v) =>
            onChange({
              ...field,
              mimeFilter:
                v.trim() === ""
                  ? undefined
                  : v.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      );
    default:
      return null;
  }
}

/**
 * Options editor for `select` / `multiSelect` fields.
 *
 * Options carry stable ids so renaming a label or value doesn't break
 * items that already reference the option. Adding / removing options
 * is freeform — the API doesn't currently warn when an option in use
 * is removed.
 */
function OptionsEditor({
  field,
  onChange,
}: {
  field: Extract<FieldDef, { type: "select" | "multiSelect" }>;
  onChange: (next: FieldDef) => void;
}) {
  const setOption = (idx: number, next: SelectOption | null) => {
    const nextOptions =
      next === null
        ? field.options.filter((_, i) => i !== idx)
        : field.options.map((opt, i) => (i === idx ? next : opt));
    onChange({ ...field, options: nextOptions });
  };
  const addOption = () => {
    const id = `opt_${crypto.randomUUID().slice(0, 8)}`;
    onChange({
      ...field,
      options: [...field.options, { id, value: id, label: "New option" }],
    });
  };
  return (
    <Field label="Options" description="The list of choices artists can pick from.">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        {field.options.map((opt, idx) => (
          <div
            key={opt.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: "var(--space-2)",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={opt.value}
              placeholder="value"
              onChange={(e) => setOption(idx, { ...opt, value: e.target.value })}
              style={smallInputStyle}
            />
            <input
              type="text"
              value={opt.label}
              placeholder="Label"
              onChange={(e) => setOption(idx, { ...opt, label: e.target.value })}
              style={smallInputStyle}
            />
            <button
              type="button"
              onClick={() => setOption(idx, null)}
              disabled={field.options.length === 1}
              style={removeOptionButtonStyle}
              aria-label={`Remove option ${opt.label}`}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          style={{
            padding: "var(--space-1) var(--space-3)",
            background: "transparent",
            border: "1px dashed var(--color-border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
            justifySelf: "start",
          }}
        >
          + Add option
        </button>
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Default sort editor
// ---------------------------------------------------------------------------

function DefaultSortEditor({
  def,
  onChange,
}: {
  def: CollectionDef;
  onChange: (next: CollectionDef) => void;
}) {
  const mode = def.defaultSort?.mode ?? "alphabetic";
  const sortableFields = def.fields.filter((f) => SORTABLE_FIELD_TYPES.has(f.type));
  return (
    <>
      <SelectField
        label="Default sort"
        description="How items appear in lists when the artist hasn't picked a custom order."
        value={mode}
        options={[
          { label: "Alphabetic (by slug)", value: "alphabetic" },
          { label: "Manual (drag to reorder)", value: "manual" },
          { label: "By field value", value: "fieldSort" },
        ]}
        onChange={(v) => {
          if (v === "alphabetic") onChange({ ...def, defaultSort: null });
          else if (v === "manual") onChange({ ...def, defaultSort: { mode: "manual" } });
          else
            onChange({
              ...def,
              defaultSort: {
                mode: "fieldSort",
                fieldId: sortableFields[0]?.id ?? "",
                direction: "asc",
              },
            });
        }}
      />
      {def.defaultSort?.mode === "fieldSort" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <SelectField
            label="Sort field"
            value={def.defaultSort.fieldId}
            options={sortableFields.map((f) => ({ label: f.key, value: f.id }))}
            onChange={(v) =>
              onChange({
                ...def,
                defaultSort:
                  def.defaultSort?.mode === "fieldSort"
                    ? { ...def.defaultSort, fieldId: v }
                    : null,
              })
            }
          />
          <SelectField
            label="Direction"
            value={def.defaultSort.direction}
            options={[
              { label: "Ascending", value: "asc" as const },
              { label: "Descending", value: "desc" as const },
            ]}
            onChange={(v) =>
              onChange({
                ...def,
                defaultSort:
                  def.defaultSort?.mode === "fieldSort"
                    ? { ...def.defaultSort, direction: v }
                    : null,
              })
            }
          />
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add-field row
// ---------------------------------------------------------------------------

function AddFieldRow({ onAdd }: { onAdd: (type: FieldType) => void }) {
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        background: "var(--color-surface)",
        border: "1px dashed var(--color-border-strong)",
        borderRadius: "var(--radius-sm)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "var(--space-3)",
        alignItems: "end",
      }}
    >
      <SelectField
        label="Add a new field"
        value={""}
        options={[
          { label: "Choose a type…", value: "" },
          ...FIELD_TYPE_OPTIONS,
        ]}
        onChange={(v) => {
          if (v !== "") onAdd(v as FieldType);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue / warning list
// ---------------------------------------------------------------------------

function IssueList({
  kind,
  entries,
}: {
  kind: "error" | "warning";
  entries: ReadonlyArray<SchemaEditorIssue | SchemaEditorWarning>;
}) {
  const color =
    kind === "error" ? "var(--color-danger, var(--color-text))" : "var(--color-text-emphasis)";
  const background =
    kind === "error" ? "var(--color-danger-bg, var(--color-surface-raised))" : "var(--color-surface-raised)";
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        marginBottom: "var(--space-3)",
        background,
        border: `1px solid ${color}`,
        borderRadius: "var(--radius-sm)",
      }}
      role={kind === "error" ? "alert" : "status"}
    >
      <strong style={{ color }}>{kind === "error" ? "Blocked" : "Heads-up"}</strong>
      <ul style={{ margin: "var(--space-1) 0 0", paddingLeft: "var(--space-5)" }}>
        {entries.map((entry, idx) => (
          <li key={idx} style={{ color }}>
            {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "0 var(--space-2)",
        fontSize: "var(--font-size-xs)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Build a fresh `FieldDef` for "add field". Picks a default key that
 * doesn't collide with existing ones; `required` defaults to false so
 * adding a field never blocks existing items.
 */
function makeDefaultField(type: FieldType, existingFields: ReadonlyArray<FieldDef>): FieldDef {
  const baseKey =
    FIELD_TYPE_OPTIONS.find((opt) => opt.value === type)?.label.toLowerCase().replace(/\s+/g, "_") ??
    "field";
  let key = baseKey;
  let i = 2;
  const existing = new Set(existingFields.map((f) => f.key));
  while (existing.has(key)) {
    key = `${baseKey}_${i}`;
    i += 1;
  }
  const id = newFieldId();
  switch (type) {
    case "text":
      return { id, key, type: "text", required: false };
    case "longText":
      return { id, key, type: "longText", required: false };
    case "richText":
      return { id, key, type: "richText", required: false };
    case "number":
      return { id, key, type: "number", required: false };
    case "boolean":
      return { id, key, type: "boolean" };
    case "select":
      return {
        id,
        key,
        type: "select",
        required: false,
        options: [{ id: "opt_default", value: "default", label: "Default" }],
      };
    case "multiSelect":
      return {
        id,
        key,
        type: "multiSelect",
        options: [{ id: "opt_default", value: "default", label: "Default" }],
      };
    case "date":
      return { id, key, type: "date", required: false };
    case "url":
      return { id, key, type: "url", required: false };
    case "email":
      return { id, key, type: "email", required: false };
    case "color":
      return { id, key, type: "color", required: false };
    case "image":
      return { id, key, type: "image", required: false };
    case "file":
      return { id, key, type: "file", required: false };
    case "collectionRef":
      return { id, key, type: "collectionRef", required: false, targetCollection: "pages" };
    case "multiCollectionRef":
      return { id, key, type: "multiCollectionRef", targetCollection: "pages" };
    case "puckContent":
      return { id, key, type: "puckContent" };
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      throw new Error(`Unknown field type: ${String(type)}`);
    }
  }
}

/**
 * Convert a `FieldDef` to a different `type`. Preserves `id`, `key`,
 * and `systemLocked`; everything else (per-type config like options,
 * min/max, target collection) gets a sensible default for the new
 * type. The API-side validator gates the actual transition (lossless
 * only).
 */
function changeFieldType(field: FieldDef, nextType: FieldType): FieldDef {
  const base = { id: field.id, key: field.key, systemLocked: field.systemLocked };
  switch (nextType) {
    case "text":
      return { ...base, type: "text", required: requiredOrFalse(field) };
    case "longText":
      return { ...base, type: "longText", required: requiredOrFalse(field) };
    case "richText":
      return { ...base, type: "richText", required: requiredOrFalse(field) };
    case "number":
      return { ...base, type: "number", required: requiredOrFalse(field) };
    case "boolean":
      return { ...base, type: "boolean" };
    case "select":
      return {
        ...base,
        type: "select",
        required: requiredOrFalse(field),
        options:
          "options" in field && field.options.length > 0
            ? field.options
            : [{ id: "opt_default", value: "default", label: "Default" }],
      };
    case "multiSelect":
      return {
        ...base,
        type: "multiSelect",
        options:
          "options" in field && field.options.length > 0
            ? field.options
            : [{ id: "opt_default", value: "default", label: "Default" }],
      };
    case "date":
      return { ...base, type: "date", required: requiredOrFalse(field) };
    case "url":
      return { ...base, type: "url", required: requiredOrFalse(field) };
    case "email":
      return { ...base, type: "email", required: requiredOrFalse(field) };
    case "color":
      return { ...base, type: "color", required: requiredOrFalse(field) };
    case "image":
      return { ...base, type: "image", required: requiredOrFalse(field) };
    case "file":
      return { ...base, type: "file", required: requiredOrFalse(field) };
    case "collectionRef":
      return {
        ...base,
        type: "collectionRef",
        required: requiredOrFalse(field),
        targetCollection: "targetCollection" in field ? field.targetCollection : "pages",
      };
    case "multiCollectionRef":
      return {
        ...base,
        type: "multiCollectionRef",
        targetCollection: "targetCollection" in field ? field.targetCollection : "pages",
      };
    case "puckContent":
      return { ...base, type: "puckContent" };
    default: {
      const _exhaustive: never = nextType;
      void _exhaustive;
      throw new Error(`Unknown field type: ${String(nextType)}`);
    }
  }
}

function requiredOrFalse(field: FieldDef): boolean {
  return "required" in field ? field.required : false;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sectionStyle: React.CSSProperties = {
  padding: "var(--space-5) 0",
  borderBottom: "1px solid var(--color-border)",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "var(--font-size-lg)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  margin: 0,
  marginBottom: "var(--space-3)",
};

const disabledInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface-disabled, var(--color-surface-raised))",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-mono)",
};

const smallInputStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

const removeOptionButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  background: "transparent",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: "var(--font-size-base)",
  lineHeight: 1,
};
