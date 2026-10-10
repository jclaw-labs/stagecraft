/**
 * The upgrader chain for musician-site collection definitions
 * (`_collection.json`), per ADR-016 §3 and §4.
 *
 * `UPGRADERS[n]` turns a version `n` definition into a version `n + 1`
 * one. Steps are pure and idempotent, take and return parsed JSON, and
 * import nothing: the platform worker runs this chain in a Worker with
 * no filesystem, git or Next.js. Steps are append-only and never change
 * once released, so a copy of this package can upgrade content to any
 * released `schemaVersion` up to `LATEST_SCHEMA_VERSION`.
 *
 * The chain is empty while every collection is on version 1.
 */

/** A parsed `_collection.json`. */
export type CollectionJson = { schemaVersion?: unknown; [key: string]: unknown };

/** One step: a version `n` definition in, a version `n + 1` one out. */
export type Upgrader = (collection: CollectionJson) => CollectionJson;

/** The oldest `schemaVersion` the chain starts from. */
export const OLDEST_SCHEMA_VERSION = 1;

/** `UPGRADERS[n]` upgrades version `n` to `n + 1`. Append-only. */
export const UPGRADERS: Readonly<Record<number, Upgrader>> = {};

/** The newest `schemaVersion` the chain reaches. */
export const LATEST_SCHEMA_VERSION = OLDEST_SCHEMA_VERSION + Object.keys(UPGRADERS).length;

/**
 * Upgrade a collection definition to `target` (the latest version by
 * default), one step at a time. Returns the input unchanged when it is
 * already at `target`.
 *
 * Throws when the definition has no integer `schemaVersion`, when it is
 * older than the chain starts or newer than `target` (upgrades are
 * forward-only), or when `target` is past the end of the chain.
 */
export function upgradeCollection(
  collection: CollectionJson,
  target: number = LATEST_SCHEMA_VERSION,
): CollectionJson {
  if (!Number.isInteger(target) || target < OLDEST_SCHEMA_VERSION || target > LATEST_SCHEMA_VERSION) {
    throw new RangeError(
      `Target schemaVersion ${target} is outside ${OLDEST_SCHEMA_VERSION}–${LATEST_SCHEMA_VERSION}.`,
    );
  }
  const from = collection.schemaVersion;
  if (typeof from !== "number" || !Number.isInteger(from)) {
    throw new TypeError("Collection has no integer schemaVersion.");
  }
  if (from < OLDEST_SCHEMA_VERSION) {
    throw new RangeError(`schemaVersion ${from} is older than ${OLDEST_SCHEMA_VERSION}, the oldest supported.`);
  }
  if (from > target) {
    throw new RangeError(`schemaVersion ${from} is newer than the target ${target}.`);
  }
  let upgraded = collection;
  for (let version = from; version < target; version++) {
    upgraded = UPGRADERS[version](upgraded);
  }
  return upgraded;
}
