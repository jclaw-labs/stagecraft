import type { CollectionJson, Upgrader } from "./index.js";

/**
 * Run `chain` on `collection` from its `schemaVersion` up to `target`,
 * one step at a time. Internal: `upgradeCollection` validates the input
 * and calls it with `UPGRADERS`; tests call it with a fake chain. It
 * lives outside the entry point so it isn't part of the package's API
 * (the `exports` map exposes only `index`).
 */
export function runChain(
  chain: Readonly<Record<number, Upgrader>>,
  collection: CollectionJson,
  target: number,
): CollectionJson {
  let upgraded = collection;
  for (let version = collection.schemaVersion as number; version < target; version++) {
    const step = chain[version];
    if (!step) throw new RangeError(`No upgrader from schemaVersion ${version}.`);
    upgraded = step(upgraded);
  }
  return upgraded;
}
