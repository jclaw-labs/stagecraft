/**
 * Error text for a failed page-editor save (client-safe: type imports
 * only).
 *
 * The item route answers a rejected save with
 * `{ ok: false, error: "Validation failed", issues: [...] }`. Showing
 * only `error` leaves the artist guessing which field failed, so the
 * first issue is appended, naming the field by its key when the issue
 * path points at one of the collection's fields.
 */

import type { ItemRouteIssue } from "@/app/api/collections/[slug]/items/[itemSlug]/issue-format";
import type { FieldDef } from "@/lib/collections/schema";

export type ItemRouteFailureBody = {
  ok: false;
  error?: string;
  issues?: ReadonlyArray<ItemRouteIssue>;
};

type FieldRef = Pick<FieldDef, "id" | "key">;

/**
 * Names the field an issue path points at. Paths look like
 * `values.<fieldId>[.…]`; the field's `key` reads better than its id.
 * Falls back to the raw path, or `null` for an empty path.
 */
function issueLabel(path: string, fields: ReadonlyArray<FieldRef>): string | null {
  if (!path) return null;
  const [root, fieldId] = path.split(".");
  if (root === "values" && fieldId) {
    const field = fields.find((f) => f.id === fieldId);
    if (field) return field.key;
  }
  return path;
}

export function saveErrorMessage(
  status: number,
  body: ItemRouteFailureBody | null,
  fields: ReadonlyArray<FieldRef> = [],
): string {
  const base = body?.error || `Save failed (HTTP ${status})`;
  const issue = body?.issues?.[0];
  if (!issue?.message) return base;
  const label = issueLabel(issue.path, fields);
  return label ? `${base}: ${label}: ${issue.message}` : `${base}: ${issue.message}`;
}
