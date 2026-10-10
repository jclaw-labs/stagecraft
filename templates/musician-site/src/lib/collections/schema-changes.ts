/**
 * Pure validation of schema changes (ADR-009 PR 5 / §11).
 *
 * Given an old `CollectionDef`, a proposed new one, and the current
 * set of items, decide whether the change is safe to apply. The
 * schema editor UI uses this to gate destructive operations; the API
 * route uses it as the final word before persisting.
 *
 * Decisions reflect §11:
 *
 *   - Stable field IDs. Renaming a field changes `key`, never `id`.
 *     Items reference fields by id, so renames are zero-migration.
 *   - `systemLocked` fields can't be deleted, renamed, retyped, or
 *     have their `required` flag toggled.
 *   - Add field: free. Existing items get `undefined` for the new
 *     field; required-field validation kicks in only for new items
 *     until the artist backfills.
 *   - Remove field: warn "N items have data" — caller's job to ask
 *     for confirmation. `validateSchemaChange` reports the count
 *     but doesn't block the change.
 *   - Change required (optional → required): only if every existing
 *     item already has a value for that field. Blocked otherwise.
 *   - Change type: only lossless transitions allowed. Lossy ones
 *     are blocked; the artist must remove + recreate.
 *   - Reorder: free.
 */

import {
  buildItemFileSchema,
  type CollectionDef,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type Item,
} from "./schema";
import {
  BINDABLE_SLOTS,
  isFieldTypeCompatible,
  type BindableSlotKind,
} from "./template/bindable-slots";

// ---------------------------------------------------------------------------
// Allowed type transitions (ADR §11)
// ---------------------------------------------------------------------------

/**
 * The lossless type transitions. Format: `<from>` → `<to>[]`. Adding
 * a transition here doesn't automatically make it "safe" — it means
 * the structural shape can be coerced; per-instance validity still
 * runs through the per-collection Zod schema.
 *
 * Notable transitions:
 *   - text ↔ longText (string ↔ string)
 *   - text → url / email / color: only if every existing value
 *     parses; the caller runs the parse check.
 *   - select → multiSelect: wrap each scalar in a 1-element array
 *   - multiSelect → select: only if every item has ≤ 1 option set
 *
 * Everything not listed is blocked.
 */
export const LOSSLESS_TYPE_TRANSITIONS: Readonly<Record<FieldType, ReadonlyArray<FieldType>>> = {
  text: ["longText", "url", "email", "color"],
  longText: ["text"],
  richText: [],
  number: [],
  boolean: [],
  select: ["multiSelect"],
  multiSelect: ["select"],
  date: [],
  url: ["text"],
  email: ["text"],
  color: ["text"],
  image: [],
  file: [],
  collectionRef: [],
  multiCollectionRef: [],
  puckContent: [],
};

export function canTransition(from: FieldType, to: FieldType): boolean {
  if (from === to) return true;
  return LOSSLESS_TYPE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Counting affected items
// ---------------------------------------------------------------------------

/** How many items have any value present for this field id. */
export function countItemsUsingField(items: ReadonlyArray<Item>, fieldId: string): number {
  let n = 0;
  for (const item of items) {
    if (item.values[fieldId] !== undefined) n += 1;
  }
  return n;
}

/**
 * Same shape as `countItemsUsingField`, but reports which specific
 * items have a value. Useful for the "Fix N items first" link the
 * schema editor renders when a required-flag change is blocked.
 */
export function itemsUsingField(items: ReadonlyArray<Item>, fieldId: string): Item[] {
  return items.filter((item) => item.values[fieldId] !== undefined);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SchemaChangeIssue =
  | { kind: "system-locked-deleted"; fieldId: string; fieldKey: string }
  | { kind: "system-locked-renamed"; fieldId: string; oldKey: string; newKey: string }
  | { kind: "system-locked-retyped"; fieldId: string; fieldKey: string }
  | { kind: "system-locked-required-changed"; fieldId: string; fieldKey: string }
  | { kind: "type-transition-blocked"; fieldId: string; fieldKey: string; from: FieldType; to: FieldType }
  | {
      kind: "required-flag-blocked";
      fieldId: string;
      fieldKey: string;
      missingItemCount: number;
    }
  | { kind: "duplicate-field-id"; fieldId: string }
  | { kind: "duplicate-field-key"; fieldKey: string }
  | {
      /**
       * The new dynamic Zod schema rejected an existing item's values.
       * Fires for every constraint tightening that current data
       * violates — option removed, maxLength tightened, new required
       * field added while items exist, includeTime toggled off, etc.
       */
      kind: "item-invalid-under-new-schema";
      itemSlug: string;
      /** Dot-separated zod path inside the item's values map. */
      path: string;
      /** Zod's own message — terse but precise. */
      message: string;
    }
  | {
      /**
       * A template binds (via `Bindable.binding`) to a fieldId that doesn't exist
       * in the new def. Renderer silently hides at runtime — surfacing
       * here so the artist can't save the broken state.
       */
      kind: "template-references-missing-field";
      fieldId: string;
      blockName: string;
      propName: string;
    }
  | {
      /**
       * A template binds to a field whose type isn't compatible with
       * the slot's expected kind (e.g. a Text block bound to an image
       * field).
       */
      kind: "template-binding-type-mismatch";
      fieldId: string;
      fieldKey: string;
      blockName: string;
      propName: string;
      expectedKind: BindableSlotKind | FieldType;
      actualType: FieldType;
    };

export type SchemaChangeWarning =
  | { kind: "field-removed-with-data"; fieldId: string; fieldKey: string; affectedItemCount: number }
  | {
      kind: "field-removed-with-template-bindings";
      fieldId: string;
      fieldKey: string;
      bindingCount: number;
    };

export type SchemaChangeReport = {
  ok: boolean;
  /** Blocking issues. Non-empty means the change can't be applied. */
  issues: SchemaChangeIssue[];
  /** Non-blocking warnings — the UI surfaces them and asks for confirm. */
  warnings: SchemaChangeWarning[];
  /**
   * Items whose values need to be rewritten on disk so the value's
   * `type` discriminator matches the new field's type (lossless type
   * transitions per ADR §11). The route writes these as part of the
   * save and includes them in the same publish commit as the def.
   *
   * Computed unconditionally — even when `ok` is false — so callers
   * can preview the planned rewrite. The route only acts on it when
   * `ok` is true.
   */
  migratedItems: Item[];
};

/**
 * Compare two CollectionDefs and the current items, return what's
 * blocking and what's worth warning about.
 *
 * `items` should reflect the on-disk state right before the change.
 * The caller (the API route) reads items via `listItemsInOrder`
 * before calling here.
 */
export function validateSchemaChange(
  oldDef: CollectionDef,
  newDef: CollectionDef,
  items: ReadonlyArray<Item>,
): SchemaChangeReport {
  const issues: SchemaChangeIssue[] = [];
  const warnings: SchemaChangeWarning[] = [];

  const newFieldsById = new Map(newDef.fields.map((f) => [f.id, f]));

  // Duplicate-id / duplicate-key checks. The Zod schema catches these
  // too, but reporting them here lets the UI show field-level errors
  // without losing context.
  checkDuplicates(newDef.fields, issues);

  // For every field in the OLD def, decide what happened to it.
  for (const oldField of oldDef.fields) {
    const newField = newFieldsById.get(oldField.id);
    if (!newField) {
      // Removed.
      if (oldField.systemLocked) {
        issues.push({
          kind: "system-locked-deleted",
          fieldId: oldField.id,
          fieldKey: oldField.key,
        });
      }
      const count = countItemsUsingField(items, oldField.id);
      if (count > 0) {
        warnings.push({
          kind: "field-removed-with-data",
          fieldId: oldField.id,
          fieldKey: oldField.key,
          affectedItemCount: count,
        });
      }
      continue;
    }

    // Field still exists; compare attributes.
    if (oldField.systemLocked) {
      if (oldField.key !== newField.key) {
        issues.push({
          kind: "system-locked-renamed",
          fieldId: oldField.id,
          oldKey: oldField.key,
          newKey: newField.key,
        });
      }
      if (oldField.type !== newField.type) {
        issues.push({
          kind: "system-locked-retyped",
          fieldId: oldField.id,
          fieldKey: oldField.key,
        });
      }
      if (
        "required" in oldField &&
        "required" in newField &&
        oldField.required !== newField.required
      ) {
        issues.push({
          kind: "system-locked-required-changed",
          fieldId: oldField.id,
          fieldKey: oldField.key,
        });
      }
    }

    if (oldField.type !== newField.type && !canTransition(oldField.type, newField.type)) {
      issues.push({
        kind: "type-transition-blocked",
        fieldId: oldField.id,
        fieldKey: newField.key,
        from: oldField.type,
        to: newField.type,
      });
    }

    // Required-flag change: optional → required is only OK if every
    // existing item has a value. The other direction (required →
    // optional) is always safe.
    if (
      "required" in oldField &&
      "required" in newField &&
      !oldField.required &&
      newField.required
    ) {
      const missing = items.length - countItemsUsingField(items, oldField.id);
      if (missing > 0) {
        issues.push({
          kind: "required-flag-blocked",
          fieldId: oldField.id,
          fieldKey: newField.key,
          missingItemCount: missing,
        });
      }
    }
  }

  // Template-reference validation. Templates in the *new* def reference
  // fields by id. After a field is removed or retyped, those references
  // can dangle — the renderer (PR 2) silently resolves them to
  // undefined → blocks hide. Surface the dangling references so the
  // artist can't save the broken state.
  const newBindings = collectTemplateBindings(newDef);
  for (const binding of newBindings) {
    const targetField = newFieldsById.get(binding.fieldId);
    if (!targetField) {
      issues.push({
        kind: "template-references-missing-field",
        fieldId: binding.fieldId,
        blockName: binding.blockName,
        propName: binding.propName,
      });
      continue;
    }
    if (!isFieldCompatibleWithSlot(targetField, binding.expectedKind)) {
      issues.push({
        kind: "template-binding-type-mismatch",
        fieldId: binding.fieldId,
        fieldKey: targetField.key,
        blockName: binding.blockName,
        propName: binding.propName,
        expectedKind: binding.expectedKind,
        actualType: targetField.type,
      });
    }
  }
  // Companion warning: a field that *had* template bindings in the old
  // def is gone in the new one. The blocking issue above already fires
  // when the new def's templates still reference the missing field;
  // this surfaces the impact per-field for visibility.
  const oldBindings = collectTemplateBindings(oldDef);
  const removedBindingCounts = new Map<string, number>();
  for (const binding of oldBindings) {
    if (newFieldsById.has(binding.fieldId)) continue;
    removedBindingCounts.set(
      binding.fieldId,
      (removedBindingCounts.get(binding.fieldId) ?? 0) + 1,
    );
  }
  const oldFieldsById = new Map(oldDef.fields.map((f) => [f.id, f]));
  for (const [fieldId, count] of removedBindingCounts) {
    const oldField = oldFieldsById.get(fieldId);
    if (!oldField) continue;
    warnings.push({
      kind: "field-removed-with-template-bindings",
      fieldId,
      fieldKey: oldField.key,
      bindingCount: count,
    });
  }

  // Whole-item validation against the new dynamic Zod schema.
  //
  // This is the catch-all for every flavour of "constraint tightening
  // that current data violates": option removed, maxLength tightened,
  // new required field added while items exist, includeTime toggled,
  // multiSelect minItems raised, etc. The structural rule loops above
  // can't enumerate them all because Zod owns the per-field rules —
  // running every item through `buildItemFileSchema(newDef.fields)`
  // delegates the check to the same code that will reject reads after
  // the save, eliminating the gap.
  //
  // Lossless type transitions are applied first (`migrateItemValues`
  // returns the rewritten items) so a `text → longText` save isn't
  // flagged here when the route would in fact migrate. The migrated
  // items also flow through to the report — the route uses them
  // directly to avoid recomputing the plan.
  //
  // Always runs (no `issues.length === 0` gate). Surfacing multiple
  // problem categories in a single response saves the artist from a
  // fix-one-find-another stutter. To avoid pile-up when a field has
  // a structural issue *and* its items would naturally fail the new
  // schema (e.g. a blocked retype + value-shape mismatch), the
  // whole-item issues are deduplicated per field: any path under a
  // field that already has a structural issue is suppressed.
  const migratedItems = migrateItemValues(oldDef, newDef, items);
  const migratedBySlug = new Map(migratedItems.map((m) => [m.slug, m]));
  const fileSchema = buildItemFileSchema(newDef.fields);
  const fieldsWithStructuralIssues = new Set(
    issues.flatMap((i) => ("fieldId" in i && i.fieldId ? [i.fieldId] : [])),
  );
  for (const item of items) {
    const view = migratedBySlug.get(item.slug) ?? item;
    const parsed = fileSchema.safeParse({
      id: view.id,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      values: view.values,
    });
    if (parsed.success) continue;
    for (const zodIssue of parsed.error.issues) {
      // Zod's path for an item-values error is ["values", fieldId, ...].
      // Skip issues whose field is already covered by a structural
      // issue above — those would be downstream noise from the same
      // root cause.
      const fieldId =
        zodIssue.path[0] === "values" && typeof zodIssue.path[1] === "string"
          ? zodIssue.path[1]
          : undefined;
      if (fieldId && fieldsWithStructuralIssues.has(fieldId)) continue;
      issues.push({
        kind: "item-invalid-under-new-schema",
        itemSlug: item.slug,
        path: zodIssue.path.join("."),
        message: zodIssue.message,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    migratedItems,
  };
}

function checkDuplicates(fields: ReadonlyArray<FieldDef>, issues: SchemaChangeIssue[]): void {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const field of fields) {
    if (seenIds.has(field.id)) {
      issues.push({ kind: "duplicate-field-id", fieldId: field.id });
    }
    seenIds.add(field.id);
    if (seenKeys.has(field.key)) {
      issues.push({ kind: "duplicate-field-key", fieldKey: field.key });
    }
    seenKeys.add(field.key);
  }
}

// ---------------------------------------------------------------------------
// Item-value migration for lossless type transitions
//
// `validateSchemaChange` accepts text↔longText, text→url/email/color,
// and select↔multiSelect (per ADR §11). But on-disk item values
// carry a `type` discriminator that has to match the new
// `FieldDef.type`, or the per-collection dynamic Zod rejects the
// next read. `migrateItemValues` walks the items and rewrites
// affected values' `type` (and, for select↔multiSelect, the value
// shape too).
//
// Returns only items that actually changed. The schema route writes
// these back to disk before responding, and includes them in the
// same publish call as the def, so a deploy lands the new types and
// the new item shapes together.
// ---------------------------------------------------------------------------

const STRING_DISCRIMINATOR_ONLY: ReadonlySet<FieldType> = new Set([
  "text",
  "longText",
  "url",
  "email",
  "color",
]);

/**
 * For every lossless type transition between `oldDef` and `newDef`,
 * rewrite the affected items' values so the value's `type`
 * discriminator matches the new field's type. Returns only items
 * that actually changed; unchanged items are not in the result.
 *
 * Lossy transitions never reach here — `validateSchemaChange` blocks
 * them. If the route calls this without validating first, unsupported
 * transitions return the input value unchanged (and the next read
 * will fail Zod parse — which is what `validateSchemaChange` exists
 * to prevent).
 */
export function migrateItemValues(
  oldDef: CollectionDef,
  newDef: CollectionDef,
  items: ReadonlyArray<Item>,
): Item[] {
  const oldFieldsById = new Map(oldDef.fields.map((f) => [f.id, f]));
  const transitions: Array<{ fieldId: string; from: FieldType; to: FieldType }> = [];
  for (const newField of newDef.fields) {
    const oldField = oldFieldsById.get(newField.id);
    if (!oldField || oldField.type === newField.type) continue;
    transitions.push({ fieldId: newField.id, from: oldField.type, to: newField.type });
  }
  if (transitions.length === 0) return [];

  const out: Item[] = [];
  for (const item of items) {
    let changed = false;
    const nextValues: Item["values"] = { ...item.values };
    for (const { fieldId, from, to } of transitions) {
      const value = nextValues[fieldId];
      if (value === undefined) continue;
      const next = transformValueForTransition(value, from, to);
      if (next === undefined) {
        // The transition dropped the value entirely (e.g. multiSelect
        // → select against an empty array — no scalar to land on).
        delete nextValues[fieldId];
        changed = true;
      } else if (next !== value) {
        nextValues[fieldId] = next;
        changed = true;
      }
    }
    if (changed) out.push({ ...item, values: nextValues });
  }
  return out;
}

/**
 * Rewrite one value to match a new field type. Returns the value
 * unchanged for unsupported transitions (they should never reach
 * here — blocked at validation time). Returns `undefined` to signal
 * "delete this entry from the item's values map" — used when
 * reducing multiSelect → select against an empty array.
 */
function transformValueForTransition(
  value: FieldValue,
  from: FieldType,
  to: FieldType,
): FieldValue | undefined {
  // Text-family ↔ text-family: same shape, just relabel.
  if (STRING_DISCRIMINATOR_ONLY.has(from) && STRING_DISCRIMINATOR_ONLY.has(to)) {
    const v = (value as { value: unknown }).value;
    if (typeof v !== "string") return value;
    return { type: to, value: v } as FieldValue;
  }
  // select → multiSelect: wrap scalar in singleton array.
  if (from === "select" && to === "multiSelect") {
    const scalar = (value as { type: "select"; value: string }).value;
    return { type: "multiSelect", value: [scalar] };
  }
  // multiSelect → select: take first array entry, drop entirely on empty.
  if (from === "multiSelect" && to === "select") {
    const arr = (value as { type: "multiSelect"; value: string[] }).value;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return { type: "select", value: arr[0] };
  }
  // Anything else — should have been blocked at validation time.
  return value;
}

// ---------------------------------------------------------------------------
// Template-binding walker
//
// Templates are stored as `puckDataLooseSchema` — `{ content: unknown[] }`
// — so we can't lean on a strongly typed walk. The walker recognises:
//
//   - Block props named in `BINDABLE_SLOTS` carrying `{ kind: "binding",
//     fieldId }` — the artist authored a binding via the editor's
//     literal/binding toggle.
//
// Slot fields (Section.children / Stack.children) hold `BlockInstance[]`
// inline on the parent's props, so the walker recurses into any array
// it finds.
// ---------------------------------------------------------------------------

type TemplateBinding = {
  fieldId: string;
  expectedKind: BindableSlotKind | FieldType;
  blockName: string;
  propName: string;
};

function collectTemplateBindings(def: CollectionDef): TemplateBinding[] {
  const bindings: TemplateBinding[] = [];
  for (const template of [def.itemTemplate, def.detailTemplate, def.listTemplate]) {
    if (!template || typeof template !== "object") continue;
    const content = (template as { content?: unknown }).content;
    if (Array.isArray(content)) walkBlocks(content, bindings);
  }
  return bindings;
}

function walkBlocks(blocks: unknown[], out: TemplateBinding[]): void {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const blockName = (block as { type?: unknown }).type;
    const props = (block as { props?: unknown }).props;
    if (typeof blockName !== "string" || !props || typeof props !== "object") continue;
    const propsObj = props as Record<string, unknown>;

    // Bindable<T> slots.
    const slotsForBlock = BINDABLE_SLOTS[blockName];
    if (slotsForBlock) {
      for (const [propName, meta] of Object.entries(slotsForBlock)) {
        const value = propsObj[propName];
        if (
          value !== null &&
          typeof value === "object" &&
          (value as { kind?: unknown }).kind === "binding" &&
          typeof (value as { fieldId?: unknown }).fieldId === "string"
        ) {
          out.push({
            fieldId: (value as { fieldId: string }).fieldId,
            expectedKind: meta.slotKind,
            blockName,
            propName,
          });
        }
      }
    }

    // Recurse into any array-valued prop (slot children).
    for (const value of Object.values(propsObj)) {
      if (Array.isArray(value)) walkBlocks(value, out);
    }
  }
}

function isFieldCompatibleWithSlot(
  field: FieldDef,
  expected: BindableSlotKind | FieldType,
): boolean {
  if (expected === "string" || expected === "image" || expected === "richText") {
    return isFieldTypeCompatible(expected, field.type);
  }
  return field.type === expected;
}

// ---------------------------------------------------------------------------
// Human-readable issue/warning messages — used by both the UI and the
// API route (the API route surfaces these in error responses so the
// editor can show them inline).
// ---------------------------------------------------------------------------

export function describeIssue(issue: SchemaChangeIssue): string {
  switch (issue.kind) {
    case "system-locked-deleted":
      return `Cannot delete "${issue.fieldKey}" — it's a system-locked field the renderer or routing depends on.`;
    case "system-locked-renamed":
      return `Cannot rename "${issue.oldKey}" — it's a system-locked field.`;
    case "system-locked-retyped":
      return `Cannot change the type of "${issue.fieldKey}" — it's a system-locked field.`;
    case "system-locked-required-changed":
      return `Cannot toggle the required flag on "${issue.fieldKey}" — it's a system-locked field.`;
    case "type-transition-blocked":
      return `Cannot change "${issue.fieldKey}" from ${issue.from} to ${issue.to} — the conversion is lossy. Remove the field and recreate it as the new type if you really want to.`;
    case "required-flag-blocked":
      return `Cannot mark "${issue.fieldKey}" as required: ${issue.missingItemCount} item${issue.missingItemCount === 1 ? "" : "s"} ${issue.missingItemCount === 1 ? "doesn't" : "don't"} have a value yet. Fill them in first.`;
    case "duplicate-field-id":
      return `Two fields share id "${issue.fieldId}". Field ids must be unique within a collection.`;
    case "duplicate-field-key":
      return `Two fields share name "${issue.fieldKey}". Field names must be unique within a collection.`;
    case "item-invalid-under-new-schema":
      return `Item "${issue.itemSlug}" would fail the new schema at ${issue.path || "(values)"}: ${issue.message}. Fix the item first, then retry this change.`;
    case "template-references-missing-field":
      return `A ${issue.blockName} block's "${issue.propName}" prop is bound to a field that no longer exists (id ${issue.fieldId}). Remove the block or pick a different field.`;
    case "template-binding-type-mismatch":
      return `A ${issue.blockName} block's "${issue.propName}" prop expects a ${issue.expectedKind}-valued field, but "${issue.fieldKey}" is type ${issue.actualType}. Pick a compatible field or change the field's type.`;
    default: {
      // Exhaustiveness check — TS errors here if a new issue kind is
      // added to the union without a matching case above. Don't
      // delete this; it's the only guardrail against silently
      // returning `undefined` from the function.
      const _exhaustive: never = issue;
      void _exhaustive;
      return "Unknown issue";
    }
  }
}

export function describeWarning(warning: SchemaChangeWarning): string {
  switch (warning.kind) {
    case "field-removed-with-data":
      return `"${warning.fieldKey}" has values on ${warning.affectedItemCount} item${warning.affectedItemCount === 1 ? "" : "s"}. Removing it deletes those values.`;
    case "field-removed-with-template-bindings":
      return `"${warning.fieldKey}" is bound in ${warning.bindingCount} template block${warning.bindingCount === 1 ? "" : "s"}. Those blocks will render nothing once the field is gone.`;
    default: {
      const _exhaustive: never = warning;
      void _exhaustive;
      return "Unknown warning";
    }
  }
}
