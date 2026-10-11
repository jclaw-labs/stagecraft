# Golden fixtures

`v<N>/` holds `_collection.json` files exactly as `schemaVersion` N wrote
them. These are frozen copies of the musician-site template's collections
at the first release that wrote that version (ADR-016 §3). Never edit a
released version's fixtures. When a new version ships, add `v<N+1>/`
beside them.

`v<N>-to-v<N+1>/` holds, for each `v<N>/<name>.json`, the
`<name>.json` that step `UPGRADERS[N]` must turn it into. Write each one
by hand from the old file, so it records what the step is meant to do
rather than what it happens to do. A step must keep the input's key
order and add no keys the schema doesn't know. Expected outputs are
frozen with the step.

The tests run every fixture through the chain:
- `src/fixtures.test.ts` checks that each fixture reaches
  `LATEST_SCHEMA_VERSION`, that every key of `UPGRADERS` has an expected
  output for every fixture of the version it upgrades from (and that no
  expected outputs exist for a step that doesn't), and compares each
  step's output with its expected output (`toEqual`, and the same key
  order).
- The template's `schema-fixtures.test.ts` checks that the upgraded result
  passes its zod schema.
