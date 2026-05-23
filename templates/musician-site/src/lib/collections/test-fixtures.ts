/**
 * Shared test fixtures for the collections module. Kept alongside the
 * production code (rather than under `__tests__/`) because vitest
 * doesn't have a dedicated fixtures convention and importing from a
 * sibling file is the simplest way to dedupe between
 * `store.test.ts` / `publish.test.ts` / future template-renderer tests.
 *
 * Fixtures are constructed via helper functions rather than exported as
 * constants so each test gets a fresh object it can mutate without
 * leaking state into sibling tests.
 */

import { CURRENT_COLLECTION_SCHEMA_VERSION, type CollectionDef, type Item } from "./schema";

/**
 * A representative tour-dates collection. Five fields covering most
 * field-type variants (date / text / select). Manual ordering disabled
 * by default (fieldSort by date) — tests that need manual mode flip the
 * `defaultSort` field.
 */
export function tourDatesDef(): CollectionDef {
  return {
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    slug: "tour-dates",
    singularName: "tour date",
    pluralName: "tour dates",
    fields: [
      { id: "f_date", key: "date", type: "date", required: true },
      { id: "f_venue", key: "venue", type: "text", required: true },
      { id: "f_city", key: "city", type: "text", required: true },
      {
        id: "f_status",
        key: "status",
        type: "select",
        required: true,
        options: [
          { id: "o1", value: "on_sale", label: "On sale" },
          { id: "o2", value: "sold_out", label: "Sold out" },
        ],
      },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: "/shows",
    defaultSort: { mode: "fieldSort", fieldId: "f_date", direction: "asc" },
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
  };
}

/**
 * Deterministic timestamp used by every fixture item so tests can
 * round-trip with stable values. The store overrides `updatedAt` on
 * write, so consumers shouldn't rely on this value surviving a save.
 */
export const FIXTURE_TIMESTAMP = "2026-05-17T18:00:00.000Z";

/**
 * A populated tour-date item, with all required fields set.
 */

export function tourDateItem(slug: string, date: string, venue: string, city: string): Item {
  return {
    id: `item_${slug}`,
    slug,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: date },
      f_venue: { type: "text", value: venue },
      f_city: { type: "text", value: city },
      f_status: { type: "select", value: "on_sale" },
    },
  };
}
