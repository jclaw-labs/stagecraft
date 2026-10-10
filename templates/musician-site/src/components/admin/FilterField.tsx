/**
 * Puck custom field for authoring a Collection block's `Filter`
 * (ADR-009 §5.1).
 *
 * Visual clause builder — one row per `FilterClause`. Each row has a
 * field picker, an operator picker, and a value editor whose shape
 * matches the operator (single value / array of values / no value).
 * Value editors run through `<FilterValueEditor>`, which toggles the
 * `FilterValue` between literal / currentItemId / currentItemField.
 *
 * Clauses are presented as ANDed; for round-trip with hand-authored
 * filters that use `any` (OR) or any shape the visual UI doesn't
 * surface, the collapsible raw-JSON pane stays — same `safeParse`
 * fallback the v1 textarea used.
 *
 * `currentItemDef` is the surrounding template's collection (the one
 * whose detail template embeds this Collection block); its fields
 * populate the `currentItemField` dropdown so a clause can say
 * "where the source item's `artist` equals the current item's `id`."
 */

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  filterSchema,
  type Filter,
  type FilterClause,
  type FilterValue,
} from "@/lib/collections/filter-schema";
import type { CollectionDef, FieldDef } from "@/lib/collections";
import type { FilterFieldsDef } from "@/lib/collections/template/filter";

import {
  CLAUSE_OPS,
  buildFilter,
  clauseToOp,
  clauseValueShape,
  defaultClause,
  defaultFilterValue,
  fieldPickFor,
  filterableFields,
  isArrayValueClause,
  isClauseIgnored,
  isFieldBearingClause,
  isSingleValueClause,
  morphClauseToOp,
  readFilter,
  setClauseField,
  setClauseValue,
  setClauseValues,
  type ClauseOp,
} from "./filter-field-state";

export type FilterFieldProps = {
  /** Filter currently stored on the block (or null when unset). */
  value: Filter | null;
  onChange: (next: Filter | null) => void;
  /**
   * Source collection — the one being iterated by this Collection
   * block. Its filterable fields populate the per-clause field picker.
   */
  sourceDef: CollectionDef;
  /**
   * Containing template's collection — the one whose detail template
   * embeds this Collection block. Its filterable fields populate the
   * `currentItemField` value editor's dropdown. Optional: pages and
   * other host surfaces have no current item.
   */
  currentItemDef?: CollectionDef;
};

/** Option shown for a saved field id the collection no longer has. */
const REMOVED_FIELD_LABEL = "removed field (ignored)";
/** Option shown for an empty saved field id, once there are fields to pick. */
const NO_FIELD_LABEL = "no field (ignored)";

function stringifyFilter(value: Filter | null): string {
  return value ? JSON.stringify(value, null, 2) : "";
}

export function FilterField({
  value,
  onChange,
  sourceDef,
  currentItemDef,
}: FilterFieldProps) {
  const sourceFields = filterableFields(sourceDef.fields);
  const currentItemFields = currentItemDef
    ? filterableFields(currentItemDef.fields)
    : [];

  const { mode, clauses } = readFilter(value);

  // Synthetic per-clause ids used as React keys on each ClauseRow. The
  // `Filter` shape carries no identity — without these, removing the
  // first clause re-keys every row by index and remounts the inputs,
  // dropping focus mid-edit on rows the artist wasn't touching. The
  // counter ref is per-FilterField so two inspectors don't collide.
  // `freshId` is wrapped in useCallback so it's a stable reference —
  // safe to list in effect deps without re-running the effect every
  // render.
  const idCounterRef = useRef(0);
  const freshId = useCallback(() => `c${++idCounterRef.current}`, []);
  const [clauseIds, setClauseIds] = useState<string[]>(() => clauses.map(freshId));

  // Resync ids when an external value change (raw-JSON edit, undo/
  // redo, programmatic reset) reshapes the clauses array. Internal
  // changes go through the emit helpers below, which keep ids in
  // lockstep with clauses and therefore never trigger the mint path.
  // Ids that line up by position survive; the rest are minted fresh.
  // `freshId` is called outside the setState updater on purpose —
  // strict mode double-invokes updaters in dev to catch impurities,
  // and minting an id mutates `idCounterRef`.
  useEffect(() => {
    if (clauseIds.length === clauses.length) return;
    setClauseIds(clauses.map((_, i) => clauseIds[i] ?? freshId()));
    // `clauses` itself is a fresh array each render (derived from
    // `value` via readFilter); only its length matters for triggering
    // the resync, so we don't subscribe to identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clauses.length, clauseIds, freshId]);

  // Raw-JSON pane local state. Mirrors the v1 textarea's
  // text-vs-parse split so the artist can type partial JSON without
  // having their input snapped back. `ownRawChangeRef` is set when
  // the artist edits the raw-JSON pane and we've just propagated the
  // parsed value via onChange — the resync effect skips one pass so
  // the artist's partial text formatting isn't pretty-printed away.
  // Visual-UI changes intentionally let the effect resync the pane.
  const [rawText, setRawText] = useState(() => stringifyFilter(value));
  const [rawError, setRawError] = useState<string | null>(null);
  const ownRawChangeRef = useRef(false);

  useEffect(() => {
    if (ownRawChangeRef.current) {
      ownRawChangeRef.current = false;
      return;
    }
    setRawText(stringifyFilter(value));
    setRawError(null);
  }, [value]);

  function emit(
    nextClauses: FilterClause[],
    nextIds: string[],
    nextMode: "all" | "any" = mode,
  ) {
    setClauseIds(nextIds);
    onChange(buildFilter(nextMode, nextClauses));
  }

  function handleAddClause() {
    emit([...clauses, defaultClause(sourceFields)], [...clauseIds, freshId()]);
  }

  function handleRemoveClause(i: number) {
    emit(
      clauses.filter((_, j) => j !== i),
      clauseIds.filter((_, j) => j !== i),
    );
  }

  function handleChangeClause(i: number, next: FilterClause) {
    // Content-only change — ids unchanged.
    emit(
      clauses.map((c, j) => (j === i ? next : c)),
      clauseIds,
    );
  }

  function handleModeChange(next: "all" | "any") {
    emit(clauses, clauseIds, next);
  }

  function handleRawChange(next: string) {
    setRawText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      ownRawChangeRef.current = true;
      setRawError(null);
      onChange(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (cause) {
      setRawError(cause instanceof Error ? cause.message : "Invalid JSON");
      return;
    }
    const result = filterSchema.safeParse(parsed);
    if (!result.success) {
      setRawError(
        result.error.issues
          .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
          .join("; "),
      );
      return;
    }
    ownRawChangeRef.current = true;
    setRawError(null);
    onChange(result.data);
  }

  return (
    <div>
      {clauses.length >= 2 ? (
        <div style={modeRowStyle}>
          <span style={modeLabelStyle}>Match</span>
          <select
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as "all" | "any")}
            style={selectStyle}
            aria-label="Clause join mode"
          >
            <option value="all">all clauses (AND)</option>
            <option value="any">any clause (OR)</option>
          </select>
        </div>
      ) : null}

      {clauses.length === 0 ? (
        <p style={emptyHintStyle}>
          No clauses — every item is rendered. Add one to filter.
        </p>
      ) : (
        <div style={clauseListStyle}>
          {clauses.map((clause, i) => (
            <ClauseRow
              // Synthetic id per clause keeps row controls stably keyed
              // when neighbours are removed mid-edit. Falls back to the
              // index only during the single render between an external
              // value change and the resync effect above.
              key={clauseIds[i] ?? `i${i}`}
              clause={clause}
              onChange={(next) => handleChangeClause(i, next)}
              onRemove={() => handleRemoveClause(i)}
              mode={mode}
              sourceDef={sourceDef}
              sourceFields={sourceFields}
              currentItemDef={currentItemDef}
              currentItemFields={currentItemFields}
            />
          ))}
        </div>
      )}

      <button type="button" onClick={handleAddClause} style={addButtonStyle}>
        + Add clause
      </button>

      <details style={detailsStyle}>
        <summary style={summaryStyle}>Raw JSON</summary>
        <textarea
          value={rawText}
          onChange={(e) => handleRawChange(e.target.value)}
          placeholder='{ "all": [...] } or leave blank for no filter'
          rows={6}
          style={{
            ...textareaStyle,
            ...(rawError ? { borderColor: "var(--color-text-error)" } : {}),
          }}
          aria-invalid={rawError !== null}
          aria-label="Filter JSON"
        />
        {rawError ? (
          <div role="alert" style={errorStyle}>
            {rawError}
          </div>
        ) : (
          <div style={hintStyle}>
            For shapes the visual editor doesn&apos;t surface (e.g. <code>any</code>{" "}
            grouping). Validated against the filter schema; invalid JSON
            won&apos;t be saved.
          </div>
        )}
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One clause row
// ---------------------------------------------------------------------------

function ClauseRow({
  clause,
  onChange,
  onRemove,
  mode,
  sourceDef,
  sourceFields,
  currentItemDef,
  currentItemFields,
}: {
  clause: FilterClause;
  onChange: (next: FilterClause) => void;
  onRemove: () => void;
  mode: "all" | "any";
  sourceDef: FilterFieldsDef;
  sourceFields: ReadonlyArray<FieldDef>;
  currentItemDef: FilterFieldsDef | undefined;
  currentItemFields: ReadonlyArray<FieldDef>;
}) {
  const op = clauseToOp(clause);
  const shape = clauseValueShape(op);

  // The saved id goes through `viewFieldIdFor` first, so a re-added
  // same-name field that the page reads shows as picked. An id the
  // collection lacks even then, or an empty one, gets its own option, so
  // the picker doesn't show its first field for a clause the page
  // ignores.
  const pick = isFieldBearingClause(clause) ? fieldPickFor(sourceDef, clause.field) : null;
  const field =
    pick?.kind === "field" ? sourceFields.find((f) => f.id === pick.fieldId) : undefined;
  const ignored =
    isFieldBearingClause(clause) && isClauseIgnored(clause, sourceDef, currentItemDef);
  // The note explains the "(ignored)" options, so the row's field pickers
  // point at it while it shows.
  const noteId = useId();
  const describedBy = ignored ? noteId : undefined;

  function handleOpChange(newOp: ClauseOp) {
    onChange(morphClauseToOp(clause, newOp, sourceFields));
  }

  return (
    <div style={rowStyle}>
      <div style={rowControlsStyle}>
        {isFieldBearingClause(clause) ? (
          <select
            value={pick?.kind === "field" ? pick.fieldId : clause.field}
            onChange={(e) => onChange(setClauseField(clause, e.target.value))}
            style={{ ...selectStyle, flex: 1 }}
            aria-label="Field"
            aria-describedby={describedBy}
          >
            {pick?.kind === "removed" ? (
              <option value={clause.field}>{REMOVED_FIELD_LABEL}</option>
            ) : null}
            {pick?.kind === "none" && sourceFields.length > 0 ? (
              <option value="">{NO_FIELD_LABEL}</option>
            ) : null}
            {sourceFields.length === 0 ? (
              <option value="">(no filterable fields)</option>
            ) : null}
            {sourceFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.key} ({f.type})
              </option>
            ))}
          </select>
        ) : (
          <span style={pseudoFieldStyle}>(no field)</span>
        )}

        <select
          value={op}
          onChange={(e) => handleOpChange(e.target.value as ClauseOp)}
          style={{ ...selectStyle, flex: 1 }}
          aria-label="Operator"
        >
          {CLAUSE_OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRemove}
          style={removeButtonStyle}
          aria-label="Remove clause"
        >
          ×
        </button>
      </div>

      {isSingleValueClause(clause) ? (
        <FilterValueEditor
          value={clause.value}
          onChange={(next) => onChange(setClauseValue(clause, next))}
          field={field}
          currentItemDef={currentItemDef}
          currentItemFields={currentItemFields}
          describedBy={describedBy}
        />
      ) : null}

      {isArrayValueClause(clause) ? (
        <ArrayValueEditor
          values={clause.values}
          onChange={(next) => onChange(setClauseValues(clause, next))}
          field={field}
          currentItemDef={currentItemDef}
          currentItemFields={currentItemFields}
          describedBy={describedBy}
        />
      ) : null}

      {ignored ? (
        <p id={noteId} style={hintStyle}>
          {mode === "any"
            ? "A field this clause uses isn't set or no longer exists, so the page ignores this whole filter."
            : "A field this clause uses isn't set or no longer exists, so the page ignores this clause."}
        </p>
      ) : null}

      {shape === "excludeCurrent" ? (
        <p style={hintStyle}>
          Hides the item the surrounding detail template is currently
          rendering (e.g. &quot;More posts by me&quot;).
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterValue editor — kind toggle (literal / currentItemId / currentItemField)
// ---------------------------------------------------------------------------

function FilterValueEditor({
  value,
  onChange,
  field,
  currentItemDef,
  currentItemFields,
  describedBy,
}: {
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  /** The source-collection field this value compares against. Undefined when the clause's field has been removed from the schema. */
  field: FieldDef | undefined;
  currentItemDef: FilterFieldsDef | undefined;
  currentItemFields: ReadonlyArray<FieldDef>;
  /** Id of the row's "ignored" note while it shows, for the field picker's `aria-describedby`. */
  describedBy: string | undefined;
}) {
  function handleKindChange(nextKind: FilterValue["kind"]) {
    if (nextKind === "literal") onChange({ kind: "literal", value: "" });
    else if (nextKind === "currentItemId") onChange({ kind: "currentItemId" });
    else onChange({ kind: "currentItemField", fieldId: currentItemFields[0]?.id ?? "" });
  }

  // Hide the `currentItemField` option when the host has no current
  // item fields to offer (e.g. the Collection block lives somewhere
  // other than a detail template). The empty dropdown would otherwise
  // let the artist save `{ kind: "currentItemField", fieldId: "" }`,
  // which the resolver can't dereference.
  const canPickCurrentItemField = currentItemFields.length > 0;

  return (
    <div style={valueEditorStyle}>
      <select
        value={value.kind}
        onChange={(e) => handleKindChange(e.target.value as FilterValue["kind"])}
        style={{ ...selectStyle, fontSize: "var(--font-size-xs)" }}
        aria-label="Value source"
      >
        <option value="literal">Literal</option>
        <option value="currentItemId">Current item ID</option>
        {canPickCurrentItemField || value.kind === "currentItemField" ? (
          <option value="currentItemField">From current item field</option>
        ) : null}
      </select>

      {value.kind === "literal" ? (
        <LiteralInput
          value={value.value}
          onChange={(next) => onChange({ kind: "literal", value: next })}
          field={field}
        />
      ) : null}

      {value.kind === "currentItemId" ? (
        <span style={pseudoFieldStyle}>current item ID</span>
      ) : null}

      {value.kind === "currentItemField" ? (
        <CurrentItemFieldSelect
          fieldId={value.fieldId}
          onChange={(fieldId) => onChange({ kind: "currentItemField", fieldId })}
          currentItemDef={currentItemDef}
          currentItemFields={currentItemFields}
          describedBy={describedBy}
        />
      ) : null}
    </div>
  );
}

/**
 * The `currentItemField` value's field picker. Resolves the saved id the
 * same way the clause's field picker does, against the surrounding
 * item's def.
 */
function CurrentItemFieldSelect({
  fieldId,
  onChange,
  currentItemDef,
  currentItemFields,
  describedBy,
}: {
  fieldId: string;
  onChange: (fieldId: string) => void;
  currentItemDef: FilterFieldsDef | undefined;
  currentItemFields: ReadonlyArray<FieldDef>;
  /** Id of the row's "ignored" note while it shows, for the field picker's `aria-describedby`. */
  describedBy: string | undefined;
}) {
  const pick = currentItemDef ? fieldPickFor(currentItemDef, fieldId) : null;
  return (
    <select
      value={pick?.kind === "field" ? pick.fieldId : fieldId}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...selectStyle, flex: 1 }}
      aria-label="Current item field"
      aria-describedby={describedBy}
    >
      {pick?.kind === "removed" ? <option value={fieldId}>{REMOVED_FIELD_LABEL}</option> : null}
      {pick?.kind === "none" && currentItemFields.length > 0 ? (
        <option value="">{NO_FIELD_LABEL}</option>
      ) : null}
      {currentItemFields.length === 0 ? (
        <option value="">(no current item fields available)</option>
      ) : null}
      {currentItemFields.map((f) => (
        <option key={f.id} value={f.id}>
          {f.key} ({f.type})
        </option>
      ))}
    </select>
  );
}

function ArrayValueEditor({
  values,
  onChange,
  field,
  currentItemDef,
  currentItemFields,
  describedBy,
}: {
  values: FilterValue[];
  onChange: (next: FilterValue[]) => void;
  field: FieldDef | undefined;
  currentItemDef: FilterFieldsDef | undefined;
  currentItemFields: ReadonlyArray<FieldDef>;
  /** Id of the row's "ignored" note while it shows, for the field picker's `aria-describedby`. */
  describedBy: string | undefined;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {values.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <FilterValueEditor
              value={v}
              onChange={(next) => onChange(values.map((existing, j) => (j === i ? next : existing)))}
              field={field}
              currentItemDef={currentItemDef}
              currentItemFields={currentItemFields}
              describedBy={describedBy}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            style={removeButtonStyle}
            aria-label="Remove value"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, defaultFilterValue()])}
        style={addValueButtonStyle}
      >
        + Add value
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Literal value input — field-type-aware
// ---------------------------------------------------------------------------

function LiteralInput({
  value,
  onChange,
  field,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  field: FieldDef | undefined;
}): ReactNode {
  // No field (deleted from the schema or empty source) — fall back to
  // a plain text input. Casts everything to/from string.
  if (!field) {
    return (
      <input
        type="text"
        value={stringifyLiteral(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
        aria-label="Literal value"
      />
    );
  }

  switch (field.type) {
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : value === "" || value == null ? "" : Number(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange("");
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }}
          step={field.step ?? undefined}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          style={{ ...inputStyle, flex: 1 }}
          aria-label="Literal number"
        />
      );

    case "boolean":
      return (
        <select
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === "true" ? true : next === "false" ? false : "");
          }}
          style={{ ...selectStyle, flex: 1 }}
          aria-label="Literal boolean"
        >
          <option value="">(unset)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );

    case "date":
      return (
        <input
          type={field.includeTime ? "datetime-local" : "date"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
          aria-label="Literal date"
        />
      );

    case "select":
    case "multiSelect": {
      // multiSelect filters compare against a single member of the
      // item-side array (see `scalarEquals` in `filter.ts`). The
      // visual editor offers the same option set either way.
      const options = field.options;
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...selectStyle, flex: 1 }}
          aria-label="Literal option"
        >
          <option value="">(pick one)</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    case "color":
      return (
        <input
          type="text"
          value={stringifyLiteral(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#rrggbb"
          style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }}
          aria-label="Literal color"
        />
      );

    case "url":
    case "email":
    case "text":
    case "longText":
    case "collectionRef":
    case "multiCollectionRef":
      return (
        <input
          type={field.type === "url" ? "url" : field.type === "email" ? "email" : "text"}
          value={stringifyLiteral(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.type === "collectionRef" || field.type === "multiCollectionRef"
              ? "item id"
              : undefined
          }
          style={{ ...inputStyle, flex: 1 }}
          aria-label="Literal value"
        />
      );

    case "richText":
    case "image":
    case "file":
    case "puckContent":
      // Non-filterable types — `filterableFields` strips these from
      // the field picker, so the FieldDef won't reach here. Render an
      // explicit dead-end if it does so the UI doesn't silently break.
      return <span style={pseudoFieldStyle}>(can&apos;t filter on {field.type})</span>;
    default: {
      // Exhaustiveness check — TS errors here if a new FieldType is
      // added without a matching case above, instead of silently
      // rendering nothing (return type is ReactNode, which permits
      // undefined). Same pattern the filter resolver uses.
      const _exhaustive: never = field;
      void _exhaustive;
      return null;
    }
  }
}

function stringifyLiteral(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Styles — CSS variables only (root globals.css)
// ---------------------------------------------------------------------------

const modeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  marginBottom: "var(--space-2)",
  fontSize: "var(--font-size-xs)",
};

const modeLabelStyle: CSSProperties = {
  color: "var(--color-text-muted)",
};

const clauseListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  marginBottom: "var(--space-2)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface-subtle)",
};

const rowControlsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  alignItems: "center",
};

const valueEditorStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-body)",
};

const pseudoFieldStyle: CSSProperties = {
  flex: 1,
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

const removeButtonStyle: CSSProperties = {
  width: "1.75rem",
  height: "1.75rem",
  flexShrink: 0,
  background: "transparent",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: "var(--font-size-base)",
  lineHeight: 1,
};

const addButtonStyle: CSSProperties = {
  background: "transparent",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-1) var(--space-3)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-sm)",
  cursor: "pointer",
};

const addValueButtonStyle: CSSProperties = {
  ...addButtonStyle,
  alignSelf: "flex-start",
  fontSize: "var(--font-size-xs)",
};

const detailsStyle: CSSProperties = {
  marginTop: "var(--space-3)",
  fontSize: "var(--font-size-xs)",
};

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  color: "var(--color-text-muted)",
  marginBottom: "var(--space-2)",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-2)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  resize: "vertical",
};

const hintStyle: CSSProperties = {
  marginTop: "var(--space-1)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};

const emptyHintStyle: CSSProperties = {
  ...hintStyle,
  margin: "0 0 var(--space-2)",
};

const errorStyle: CSSProperties = {
  marginTop: "var(--space-1)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-error)",
  lineHeight: "var(--line-height-base)",
};
