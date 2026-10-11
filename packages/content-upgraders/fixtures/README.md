# Golden fixtures

`v<N>/` holds `_collection.json` files exactly as `schemaVersion` N wrote
them. These are frozen copies of the musician-site template's collections at
the release that last wrote that version (ADR-016 §3). Never edit a released
version's fixtures. When a new version ships, add `v<N+1>/` beside them.

The tests run every fixture through the chain:
- `src/fixtures.test.ts` checks that each fixture reaches
  `LATEST_SCHEMA_VERSION`.
- The template's `schema-fixtures.test.ts` checks that the upgraded result
  passes its zod schema.
