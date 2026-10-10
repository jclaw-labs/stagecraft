/**
 * Server-side migration helpers from legacy on-disk shapes to the
 * collection `Item` shape (ADR-009 §13).
 *
 * Value-only conversions live in `./migrate-from-legacy-values.ts`
 * (re-exported here for source-compat). This module adds the
 * item-creating helper `pageDataToItem`, which calls `generateItemId`
 * from `./id-gen` and so transitively pulls in `node:crypto` — kept
 * here so client components can stay on the values-only module
 * without dragging crypto into the browser bundle.
 */

import type { Data as PuckData } from "@puckeditor/core";

import { generateItemId } from "./id-gen";
import type { Item } from "./schema";

// Re-export everything from the client-safe values module so existing
// callers (content.ts, /api/save-config-or-equivalent, the migration
// script, tests) keep working.
export * from "./migrate-from-legacy-values";

import { pageDataToItemValues } from "./migrate-from-legacy-values";

/** Build a brand-new pages item from legacy page data. */
export function pageDataToItem(
  slug: string,
  data: PuckData,
  opts: { id?: string; createdAt?: string; updatedAt?: string; showInNav?: boolean } = {},
): Item {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? generateItemId(),
    slug,
    createdAt: opts.createdAt ?? now,
    updatedAt: opts.updatedAt ?? now,
    values: pageDataToItemValues(data, { showInNav: opts.showInNav }),
  };
}

/** Re-export so the migration script + tests have one source of truth. */
export type LegacyPageInputs = {
  slug: string;
  data: PuckData;
  showInNav: boolean;
};
