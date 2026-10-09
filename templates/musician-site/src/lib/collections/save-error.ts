/**
 * Error text for a rejected item save, shared by every editor that
 * writes through the generic item routes: the page editor, the
 * generic item editor and the new-item form.
 *
 * Client-safe: type imports only, so `"use client"` files can import
 * it without dragging `node:*` modules into the bundle.
 *
 * The item routes answer a rejected save with
 * `{ ok: false, error: "Validation failed", issues: [...] }` (see
 * `zodIssuesToStructured`). Showing only `error` leaves the artist
 * guessing which field failed, so every issue is appended, naming the
 * field by its key when the issue path points at one of the
 * collection's fields.
 */

import type { FieldDef } from "./schema";

export type ItemRouteIssue = {
  /** Dot-separated Zod path inside the item file. */
  path: string;
  message: string;
};

/** The failure body of the generic item routes (POST / PUT / GET). */
export type ItemRouteFailureBody = {
  ok: false;
  error?: string;
  issues?: ReadonlyArray<ItemRouteIssue>;
};

type FieldRef = Pick<FieldDef, "id" | "key">;

/**
 * Normalises an issue path to its dot-separated form. The route sends
 * a string, but the body is parsed off the wire, so a raw Zod path
 * array is joined and anything else is dropped.
 */
function pathString(path: unknown): string {
  if (typeof path === "string") return path;
  if (Array.isArray(path)) {
    return path
      .filter((seg): seg is string | number => typeof seg === "string" || typeof seg === "number")
      .join(".");
  }
  return "";
}

/**
 * Names the field an issue path points at. Paths look like
 * `values.<fieldId>[.…]`; the field's `key` reads better than its id.
 * Falls back to the raw path, or `null` for an empty or unusable path.
 */
function issueLabel(rawPath: unknown, fields: ReadonlyArray<FieldRef>): string | null {
  const path = pathString(rawPath);
  if (!path) return null;
  const [root, fieldId] = path.split(".");
  if (root === "values" && fieldId) {
    const field = fields.find((f) => f.id === fieldId);
    if (field) return field.key;
  }
  return path;
}

/** One issue as `<field>: <message>`, or just the message when unlabelled. */
function formatIssue(issue: ItemRouteIssue, fields: ReadonlyArray<FieldRef>): string | null {
  if (typeof issue?.message !== "string" || !issue.message) return null;
  const label = issueLabel(issue.path, fields);
  return label ? `${label}: ${issue.message}` : issue.message;
}

export function saveErrorMessage(
  status: number,
  body: ItemRouteFailureBody | null,
  fields: ReadonlyArray<FieldRef> = [],
): string {
  const base = (typeof body?.error === "string" && body.error) || `Save failed (HTTP ${status})`;
  const issues = Array.isArray(body?.issues) ? body.issues : [];
  const formatted = issues
    .map((issue) => formatIssue(issue, fields))
    .filter((text): text is string => text !== null);
  return formatted.length > 0 ? `${base}: ${formatted.join("; ")}` : base;
}
