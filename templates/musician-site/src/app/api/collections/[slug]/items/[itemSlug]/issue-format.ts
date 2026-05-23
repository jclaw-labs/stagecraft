/**
 * Shared helper for converting a Zod error-issue list into the
 * structured shape the item-editor clients consume.
 *
 * Both the collection-level POST and the item-level PUT validate
 * incoming items against `buildItemFileSchema(def.fields)`. When the
 * parse fails, the route returns a 400 carrying
 * `{ ok: false, error: "Validation failed", issues: [...] }` — same
 * shape the schema editor's 409 uses for `item-invalid-under-new-
 * schema`. The clients (`NewItemClient`, `ItemEditorClient`) render
 * the issue list inline.
 *
 * Without this normalisation, the routes used to return
 * `{ ok: false, error: "Validation failed: ZodError: [...]" }` —
 * a single string with Zod's `.toString()` dumped in. The artist
 * couldn't tell which field failed.
 */

import type { z } from "zod";

export type ItemRouteIssue = {
  /** Dot-separated Zod path inside the item file. */
  path: string;
  message: string;
};

export function zodIssuesToStructured(
  issues: ReadonlyArray<z.ZodIssue>,
): ItemRouteIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
