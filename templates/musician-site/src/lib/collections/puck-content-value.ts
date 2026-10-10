/**
 * Wrap a Puck `Data` in a `puckContent`-shaped `FieldValue`.
 *
 * Lives in its own file (not in `schema.ts`) so client components
 * importing this helper don't transitively pull `node:crypto` into
 * the browser bundle via `schema.ts`'s `generateFieldId`. Same
 * client-bundling discipline as `filter-schema.ts` (which split for
 * the same reason).
 *
 * The discriminated `FieldValue` union has 16 arms; assigning the
 * `puckContent` arm directly forces TypeScript to narrow through
 * the generic `Data<...>` parameter Puck declares. The narrowing
 * fails at call sites because Puck's `Data` generic doesn't unify
 * with the curated `PuckData` alias without help — which previously
 * surfaced as four `as never` casts scattered across the editor.
 *
 * One helper, one cast site.
 */

import type { Data as PuckData } from "@puckeditor/core";

import type { FieldValue } from "./schema";

export function puckContentValue(
  data: PuckData,
): Extract<FieldValue, { type: "puckContent" }> {
  return { type: "puckContent", value: data };
}
